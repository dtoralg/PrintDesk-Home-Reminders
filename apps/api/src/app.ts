import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createApiDependencies,
  type ArtifactStore,
  type EventPublisher,
  type PrinterCheckPublisher,
  type PrintDeskRepository,
  type RequestGraph,
  type StoredNotionSync,
  type StoredPrinterCheck,
  type StoredPrintJob,
  isAllowedNotionUrl,
} from "@printdesk/backend";
import {
  createRequestCommandSchema,
  type PrinterCheckRequestedEvent,
  type PrinterCheckView,
  type CreateRequestResult,
  type NotionSyncView,
  type PrintJobView,
  type RequestHistoryResult,
  type RequestStateResult,
} from "@printdesk/shared-models";
import { authenticate } from "./auth.js";
import { productionDeviceAuthenticator, type DeviceAuthenticator } from "./device-auth.js";

export interface AppOptions {
  dataDir?: string;
  publicBaseUrl?: string;
  repository?: PrintDeskRepository;
  artifacts?: ArtifactStore;
  events?: EventPublisher;
  printerChecks?: PrinterCheckPublisher;
  deviceAuthenticator?: DeviceAuthenticator;
}

const idSchema = z.uuid();
const printerIdSchema = z.string().trim().min(1).max(80);
const shortCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{8,32}$/);

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]!);
}

function view(job: StoredPrintJob, baseUrl: string): PrintJobView {
  return {
    jobId: job.jobId,
    requestId: job.requestId,
    printerId: job.printerId,
    status: job.status,
    previewUrl: job.previewPath ? `${baseUrl}/v1/print-jobs/${job.jobId}/preview` : null,
    attempts: job.attempts,
    error: job.error,
    updatedAt: job.updatedAt,
  };
}

function printerCheckView(check: StoredPrinterCheck): PrinterCheckView {
  return {
    checkId: check.checkId,
    printerId: check.printerId,
    status: check.status,
    error: check.error,
    requestedAt: check.requestedAt,
    updatedAt: check.updatedAt,
  };
}

function notionView(sync: StoredNotionSync | null): NotionSyncView {
  return sync ? {
    status: sync.status,
    url: sync.pageUrl,
    error: sync.error,
    updatedAt: sync.updatedAt,
  } : {
    status: "pending",
    url: null,
    error: null,
    updatedAt: null,
  };
}

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  await app.register(cors, { origin: true, exposedHeaders: ["idempotency-key"] });
  const defaults = options.repository && options.artifacts && options.events
    ? null
    : createApiDependencies(options.dataDir);
  const repository = options.repository ?? defaults!.repository;
  const artifacts = options.artifacts ?? defaults!.artifacts;
  const events = options.events ?? defaults!.events;
  const printerChecks = options.printerChecks ?? defaults?.printerChecks ?? {
    publish: async (event: PrinterCheckRequestedEvent) => event.eventId,
  };
  const baseUrl = options.publicBaseUrl ?? process.env.PRINTDESK_PUBLIC_BASE_URL ?? "http://localhost:8080";
  const deviceAuthenticator = options.deviceAuthenticator ?? productionDeviceAuthenticator();

  async function authorizeDevice(authorization: string | undefined) {
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH === "true" && process.env.NODE_ENV !== "production") return true;
    try {
      await deviceAuthenticator.authenticate(authorization);
      return true;
    } catch {
      return false;
    }
  }

  async function ownedJob(jobId: string, uid: string) {
    const job = await repository.getJob(jobId);
    if (!job) return null;
    const storedRequest = await repository.getRequest(job.requestId);
    return storedRequest?.createdBy.uid === uid ? job : null;
  }

  async function ownedPrinterCheck(checkId: string, uid: string) {
    const check = await repository.getPrinterCheck(checkId);
    return check?.requestedBy.uid === uid ? check : null;
  }

  app.get("/health", async () => ({ status: "ok", backend: process.env.PRINTDESK_BACKEND ?? "local" }));

  app.post("/v1/requests", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const command = createRequestCommandSchema.safeParse(request.body);
    if (!command.success) return reply.code(400).send({ error: "invalid_request", issues: command.error.issues });

    const rawKey = request.headers["idempotency-key"];
    const suppliedKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;
    if (suppliedKey && (suppliedKey.length > 128 || suppliedKey.length < 8)) {
      return reply.code(400).send({ error: "invalid_idempotency_key" });
    }
    const idempotencyKey = suppliedKey ?? randomUUID();
    const commandId = createHash("sha256").update(`${actor.uid}:${idempotencyKey}`).digest("hex");
    const requestId = randomUUID();
    const jobId = randomUUID();
    const eventId = randomUUID();
    const shortCode = randomBytes(6).toString("base64url");
    const now = new Date().toISOString();
    const graph: RequestGraph = {
      commandId,
      request: {
        requestId,
        input: command.data.request,
        createdBy: actor,
        source: command.data.source,
        shortCode,
        shortUrl: `${baseUrl}/r/${shortCode}`,
        createdAt: now,
      },
      job: {
        jobId,
        requestId,
        printerId: command.data.printerId,
        status: "rendering",
        previewPath: null,
        escposPath: null,
        attempts: 0,
        error: null,
        renderLeaseEventId: null,
        renderLeaseExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
      event: { eventId, requestId, jobId, occurredAt: now },
    };
    const stored = await repository.createRequestGraph(graph);
    try {
      await events.publish(stored.event);
    } catch (error) {
      request.log.error({ error, eventId: stored.event.eventId }, "Unable to publish request.created");
      return reply.code(503).send({
        error: "event_publish_failed",
        retryWithIdempotencyKey: idempotencyKey,
        requestId: stored.request.requestId,
        jobId: stored.job.jobId,
      });
    }
    const currentJob = await repository.getJob(stored.job.jobId) ?? stored.job;
    const notion = await repository.getNotionSync(stored.request.requestId);
    const result: CreateRequestResult = {
      requestId: stored.request.requestId,
      job: view(currentJob, baseUrl),
      notion: notionView(notion),
      shortCode: stored.request.shortCode,
      shortUrl: stored.request.shortUrl,
    };
    reply.header("idempotency-key", idempotencyKey);
    return reply.code(stored.created ? 202 : 200).send(result);
  });

  app.get("/v1/requests", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = z.object({ limit: z.coerce.number().int().min(1).max(30).default(20) }).safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_query" });
    const entries = await repository.listRequestsByOwner(actor.uid, parsed.data.limit);
    const result: RequestHistoryResult = {
      items: await Promise.all(entries.map(async ({ request: storedRequest, job }) => ({
        requestId: storedRequest.requestId,
        shortUrl: storedRequest.shortUrl,
        request: storedRequest.input,
        createdAt: storedRequest.createdAt,
        job: view(job, baseUrl),
        notion: notionView(await repository.getNotionSync(storedRequest.requestId)),
      }))),
    };
    return result;
  });

  app.get("/v1/requests/:requestId", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = idSchema.safeParse((request.params as { requestId: string }).requestId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_request_id" });
    const storedRequest = await repository.getRequest(parsed.data);
    if (!storedRequest || storedRequest.createdBy.uid !== actor.uid) {
      return reply.code(404).send({ error: "not_found" });
    }
    const job = await repository.getJobByRequestId(parsed.data);
    if (!job) return reply.code(404).send({ error: "not_found" });
    const result: RequestStateResult = {
      requestId: storedRequest.requestId,
      shortUrl: storedRequest.shortUrl,
      job: view(job, baseUrl),
      notion: notionView(await repository.getNotionSync(storedRequest.requestId)),
    };
    return result;
  });

  app.get("/v1/printers/:printerId/checks/latest", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = printerIdSchema.safeParse((request.params as { printerId: string }).printerId);
    if (!parsed.success || parsed.data !== "home") return reply.code(400).send({ error: "invalid_printer_id" });
    const check = await repository.getLatestPrinterCheck(actor.uid, parsed.data);
    return check ? printerCheckView(check) : reply.code(204).send();
  });

  app.post("/v1/printers/:printerId/checks", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = printerIdSchema.safeParse((request.params as { printerId: string }).printerId);
    if (!parsed.success || parsed.data !== "home") return reply.code(400).send({ error: "invalid_printer_id" });
    const now = new Date().toISOString();
    const check: StoredPrinterCheck = {
      checkId: randomUUID(),
      printerId: parsed.data,
      requestedBy: actor,
      status: "pending",
      error: null,
      requestedAt: now,
      updatedAt: now,
    };
    await repository.createPrinterCheck(check);
    const event: PrinterCheckRequestedEvent = {
      eventId: randomUUID(),
      checkId: check.checkId,
      printerId: check.printerId,
      occurredAt: now,
    };
    try {
      await printerChecks.publish(event);
    } catch (error) {
      request.log.error({ error, checkId: check.checkId }, "Unable to publish printer-check.requested");
      await repository.completePrinterCheck(check.checkId, false, "check_dispatch_failed");
      return reply.code(503).send({ error: "check_dispatch_failed", checkId: check.checkId });
    }
    return reply.code(202).send(printerCheckView(check));
  });

  app.get("/v1/printer-checks/:checkId", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = idSchema.safeParse((request.params as { checkId: string }).checkId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_check_id" });
    const check = await ownedPrinterCheck(parsed.data, actor.uid);
    if (!check) return reply.code(404).send({ error: "not_found" });
    return printerCheckView(check);
  });

  app.get("/v1/print-jobs/:jobId", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await ownedJob(parsed.data, actor.uid);
    if (!job) return reply.code(404).send({ error: "not_found" });
    return view(job, baseUrl);
  });

  app.get("/v1/print-jobs/:jobId/preview", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await ownedJob(parsed.data, actor.uid);
    if (!job?.previewPath) return reply.code(404).send({ error: "not_found" });
    return reply.type("image/png").send(await artifacts.read(job.previewPath));
  });

  app.post("/v1/print-jobs/:jobId/claim", async (request, reply) => {
    if (!await authorizeDevice(request.headers.authorization)) return reply.code(401).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await repository.claimJob(parsed.data);
    if (!job) return reply.code(409).send({ error: "job_not_queued" });
    return { artifactUrl: `/v1/print-jobs/${job.jobId}/artifact` };
  });

  app.get("/v1/print-jobs/:jobId/artifact", async (request, reply) => {
    if (!await authorizeDevice(request.headers.authorization)) return reply.code(401).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await repository.getJob(parsed.data);
    if (!job?.escposPath || job.status !== "claimed") return reply.code(409).send({ error: "job_not_claimed" });
    return reply.type("application/octet-stream").send(await artifacts.read(job.escposPath));
  });

  app.post("/v1/print-jobs/:jobId/status", async (request, reply) => {
    if (!await authorizeDevice(request.headers.authorization)) return reply.code(401).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const body = z.object({ status: z.enum(["checking_printer", "printing"]) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_status" });
    const job = await repository.updatePrintStatus(parsed.data, body.data.status);
    if (!job) return reply.code(409).send({ error: "invalid_status_transition" });
    return view(job, baseUrl);
  });

  app.post("/v1/print-jobs/:jobId/complete", async (request, reply) => {
    if (!await authorizeDevice(request.headers.authorization)) return reply.code(401).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const body = z.object({ outcome: z.enum(["printed", "printed_simulated"]) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_outcome" });
    const job = await repository.completePrint(parsed.data, body.data.outcome);
    if (!job) return reply.code(409).send({ error: "job_not_printing" });
    return view(job, baseUrl);
  });

  app.post("/v1/print-jobs/:jobId/fail", async (request, reply) => {
    if (!await authorizeDevice(request.headers.authorization)) return reply.code(401).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const body = z.object({ error: z.string().trim().min(1).max(500), retryable: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_failure" });
    const job = await repository.failPrint(parsed.data, body.data.error, body.data.retryable);
    if (!job) return reply.code(409).send({ error: "job_not_active" });
    return view(job, baseUrl);
  });

  app.post("/v1/printer-checks/:checkId/claim", async (request, reply) => {
    if (!await authorizeDevice(request.headers.authorization)) return reply.code(401).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { checkId: string }).checkId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_check_id" });
    const check = await repository.claimPrinterCheck(parsed.data);
    if (!check) return reply.code(409).send({ error: "check_not_pending" });
    return printerCheckView(check);
  });

  app.post("/v1/printer-checks/:checkId/complete", async (request, reply) => {
    if (!await authorizeDevice(request.headers.authorization)) return reply.code(401).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { checkId: string }).checkId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_check_id" });
    const body = z.object({
      available: z.boolean(),
      error: z.string().trim().min(1).max(500).nullable(),
    }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_outcome" });
    const check = await repository.completePrinterCheck(parsed.data, body.data.available, body.data.error);
    if (!check) return reply.code(409).send({ error: "check_not_active" });
    return printerCheckView(check);
  });

  app.get("/r/:code", async (request, reply) => {
    const parsed = shortCodeSchema.safeParse((request.params as { code: string }).code);
    if (!parsed.success) return reply.code(404).type("text/plain; charset=utf-8").send("Ticket no encontrado.");
    const stored = await repository.getRequestByShortCode(parsed.data);
    if (!stored) return reply.code(404).type("text/plain; charset=utf-8").send("Ticket no encontrado.");
    const query = z.object({ view: z.literal("live").optional() }).safeParse(request.query);
    const notion = await repository.getNotionSync(stored.requestId);
    if (query.success && query.data.view !== "live" && notion?.status === "ready" && notion.pageUrl && isAllowedNotionUrl(notion.pageUrl)) {
      return reply.redirect(notion.pageUrl);
    }
    const title = escapeHtml(stored.input.title);
    const body = escapeHtml(stored.input.body || "Sin detalles adicionales.").replaceAll("\n", "<br>");
    const kind = escapeHtml(stored.input.type.toUpperCase());
    const creator = escapeHtml(stored.createdBy.displayName || stored.createdBy.email || "PrintDesk");
    const due = stored.input.dueAt
      ? `<p class="meta">◷ ${escapeHtml(new Intl.DateTimeFormat("es-ES", { dateStyle: "long", timeZone: "Europe/Madrid" }).format(new Date(stored.input.dueAt)))}</p>`
      : "";
    const created = escapeHtml(new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "Europe/Madrid" }).format(new Date(stored.createdAt)));
    return reply.type("text/html; charset=utf-8").send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · PrintDesk</title><style>
*{box-sizing:border-box}body{background:#f4f4f1;color:#111;font-family:Arial,sans-serif;margin:0;padding:24px}
main{background:#fff;border:1px solid #111;margin:6vh auto;max-width:620px;padding:clamp(24px,6vw,54px)}
.brand{align-items:center;border-bottom:1px solid #bbb;display:flex;font-weight:700;gap:8px;margin:0 0 40px;padding-bottom:18px}
.kind{font:700 12px monospace;letter-spacing:.12em}.title{font-size:clamp(32px,8vw,58px);letter-spacing:-.055em;line-height:1;margin:18px 0}
.body{font-size:18px;line-height:1.6;margin:28px 0 38px}.meta{border-top:1px dashed #888;font-size:13px;margin:0;padding:14px 0 0}
footer{border-top:1px solid #bbb;color:#555;font-size:12px;margin-top:42px;padding-top:18px}
</style></head><body><main><p class="brand">▣ PrintDesk</p><span class="kind">${kind}${stored.input.important ? " · ★" : ""}</span>
<h1 class="title">${title}</h1><p class="body">${body}</p>${due}<footer>♙ ${creator}<br>▣ ${created}</footer></main></body></html>`);
  });

  return app;
}
