import Fastify from "fastify";
import cors from "@fastify/cors";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createApiDependencies,
  type ArtifactStore,
  type EventPublisher,
  type PrintDeskRepository,
  type RequestGraph,
  type StoredPrintJob,
} from "@printdesk/backend";
import {
  createRequestCommandSchema,
  type CreateRequestResult,
  type PrintJobView,
} from "@printdesk/shared-models";
import { authenticate } from "./auth.js";

export interface AppOptions {
  dataDir?: string;
  publicBaseUrl?: string;
  repository?: PrintDeskRepository;
  artifacts?: ArtifactStore;
  events?: EventPublisher;
}

const idSchema = z.uuid();

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

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  await app.register(cors, { origin: true, exposedHeaders: ["idempotency-key"] });
  const defaults = options.repository && options.artifacts && options.events
    ? null
    : createApiDependencies(options.dataDir);
  const repository = options.repository ?? defaults!.repository;
  const artifacts = options.artifacts ?? defaults!.artifacts;
  const events = options.events ?? defaults!.events;
  const baseUrl = options.publicBaseUrl ?? process.env.PRINTDESK_PUBLIC_BASE_URL ?? "http://localhost:8080";

  async function ownedJob(jobId: string, uid: string) {
    const job = await repository.getJob(jobId);
    if (!job) return null;
    const storedRequest = await repository.getRequest(job.requestId);
    return storedRequest?.createdBy.uid === uid ? job : null;
  }

  app.get("/healthz", async () => ({ status: "ok", backend: process.env.PRINTDESK_BACKEND ?? "local" }));

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
    const result: CreateRequestResult = {
      requestId: stored.request.requestId,
      job: view(currentJob, baseUrl),
      shortCode: stored.request.shortCode,
      shortUrl: stored.request.shortUrl,
    };
    reply.header("idempotency-key", idempotencyKey);
    return reply.code(stored.created ? 202 : 200).send(result);
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
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH !== "true" || process.env.NODE_ENV === "production") return reply.code(403).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await repository.claimJob(parsed.data);
    if (!job) return reply.code(409).send({ error: "job_not_queued" });
    return { artifactUrl: `/v1/print-jobs/${job.jobId}/artifact` };
  });

  app.get("/v1/print-jobs/:jobId/artifact", async (request, reply) => {
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH !== "true" || process.env.NODE_ENV === "production") return reply.code(403).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await repository.getJob(parsed.data);
    if (!job?.escposPath || job.status !== "claimed") return reply.code(409).send({ error: "job_not_claimed" });
    return reply.type("application/octet-stream").send(await artifacts.read(job.escposPath));
  });

  app.post("/v1/print-jobs/:jobId/complete", async (request, reply) => {
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH !== "true" || process.env.NODE_ENV === "production") return reply.code(403).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const body = z.object({ outcome: z.enum(["printed", "printed_simulated"]) }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_outcome" });
    const job = await repository.completePrint(parsed.data, body.data.outcome);
    if (!job) return reply.code(409).send({ error: "job_not_claimed" });
    return view(job, baseUrl);
  });

  app.post("/v1/print-jobs/:jobId/fail", async (request, reply) => {
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH !== "true" || process.env.NODE_ENV === "production") return reply.code(403).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const body = z.object({ error: z.string().trim().min(1).max(500), retryable: z.boolean() }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_failure" });
    const job = await repository.failPrint(parsed.data, body.data.error, body.data.retryable);
    if (!job) return reply.code(409).send({ error: "job_not_claimed" });
    return view(job, baseUrl);
  });

  app.get("/r/:code", async (_request, reply) =>
    reply.code(202).type("text/html; charset=utf-8").send("<p>Estamos preparando esta nota…</p>"),
  );

  return app;
}
