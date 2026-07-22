import Fastify from "fastify";
import cors from "@fastify/cors";
import { createReadStream } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { z } from "zod";
import {
  createRequestCommandSchema,
  type CreateRequestResult,
  type PrintJobView,
} from "@printdesk/shared-models";
import { authenticate } from "./auth.js";
import { LocalStore } from "./local-store.js";
import { renderRequest } from "./renderer.js";
import type { StoredPrintJob, StoredRequest } from "./types.js";

export interface AppOptions {
  dataDir?: string;
  publicBaseUrl?: string;
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
  await app.register(cors, { origin: true });
  const dataDir = options.dataDir ?? process.env.PRINTDESK_DATA_DIR ?? ".local-data";
  const baseUrl = options.publicBaseUrl ?? process.env.PRINTDESK_PUBLIC_BASE_URL ?? "http://localhost:8080";
  const store = new LocalStore(dataDir);

  app.get("/healthz", async () => ({ status: "ok" }));

  app.post("/v1/requests", async (request, reply) => {
    let actor;
    try {
      actor = await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const command = createRequestCommandSchema.safeParse(request.body);
    if (!command.success) return reply.code(400).send({ error: "invalid_request", issues: command.error.issues });

    const requestId = randomUUID();
    const jobId = randomUUID();
    const shortCode = randomBytes(6).toString("base64url");
    const now = new Date().toISOString();
    const storedRequest: StoredRequest = {
      requestId,
      input: command.data.request,
      createdBy: actor,
      source: command.data.source,
      shortCode,
      shortUrl: `${baseUrl}/r/${shortCode}`,
      createdAt: now,
    };
    const job: StoredPrintJob = {
      jobId,
      requestId,
      printerId: command.data.printerId,
      status: "rendering",
      previewPath: null,
      escposPath: null,
      attempts: 0,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await Promise.all([store.putRequest(storedRequest), store.putJob(job)]);

    try {
      const artifacts = await renderRequest(storedRequest, `${store.root}/artifacts`);
      Object.assign(job, artifacts, { status: "queued", updatedAt: new Date().toISOString() });
    } catch (error) {
      Object.assign(job, { status: "failed", error: (error as Error).message, updatedAt: new Date().toISOString() });
    }
    await store.putJob(job);
    const result: CreateRequestResult = {
      requestId,
      job: view(job, baseUrl),
      shortCode,
      shortUrl: storedRequest.shortUrl,
    };
    return reply.code(job.status === "queued" ? 201 : 500).send(result);
  });

  app.get("/v1/print-jobs/:jobId", async (request, reply) => {
    try {
      await authenticate(request.headers.authorization);
    } catch {
      return reply.code(401).send({ error: "unauthorized" });
    }
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await store.getJob(parsed.data);
    if (!job) return reply.code(404).send({ error: "not_found" });
    return view(job, baseUrl);
  });

  app.get("/v1/print-jobs/:jobId/preview", async (request, reply) => {
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH !== "true" || process.env.NODE_ENV === "production") {
      return reply.code(403).send({ error: "signed_preview_required" });
    }
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await store.getJob(parsed.data);
    if (!job?.previewPath) return reply.code(404).send({ error: "not_found" });
    return reply.type("image/png").send(createReadStream(job.previewPath));
  });

  app.post("/v1/print-jobs/:jobId/claim", async (request, reply) => {
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH !== "true" || process.env.NODE_ENV === "production") return reply.code(403).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await store.getJob(parsed.data);
    if (!job?.escposPath) return reply.code(404).send({ error: "not_found" });
    if (job.status !== "queued") return reply.code(409).send({ error: "job_not_queued", status: job.status });
    Object.assign(job, { status: "claimed", attempts: job.attempts + 1, updatedAt: new Date().toISOString() });
    await store.putJob(job);
    return { artifactUrl: `/v1/print-jobs/${job.jobId}/artifact` };
  });

  app.get("/v1/print-jobs/:jobId/artifact", async (request, reply) => {
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH !== "true" || process.env.NODE_ENV === "production") return reply.code(403).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const job = await store.getJob(parsed.data);
    if (!job?.escposPath || job.status !== "claimed") return reply.code(409).send({ error: "job_not_claimed" });
    return reply.type("application/octet-stream").send(createReadStream(job.escposPath));
  });

  app.post("/v1/print-jobs/:jobId/complete", async (request, reply) => {
    if (process.env.PRINTDESK_ALLOW_DEV_AUTH !== "true" || process.env.NODE_ENV === "production") return reply.code(403).send({ error: "device_auth_required" });
    const parsed = idSchema.safeParse((request.params as { jobId: string }).jobId);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job_id" });
    const body = z.object({ outcome: z.literal("printed_simulated") }).safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_outcome" });
    const job = await store.getJob(parsed.data);
    if (!job || job.status !== "claimed") return reply.code(409).send({ error: "job_not_claimed" });
    Object.assign(job, { status: body.data.outcome, updatedAt: new Date().toISOString() });
    await store.putJob(job);
    return view(job, baseUrl);
  });

  app.get("/r/:code", async (_request, reply) =>
    reply.code(202).type("text/html; charset=utf-8").send("<p>Estamos preparando esta nota…</p>"),
  );

  return app;
}
