import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RequestGraph } from "./domain.js";
import { FileRepository } from "./file-adapters.js";

let directory: string;
let graph: RequestGraph;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "printdesk-repo-"));
  const now = new Date().toISOString();
  graph = {
    commandId: "command-1",
    request: {
      requestId: "11111111-1111-4111-8111-111111111111",
      input: { type: "task", title: "Prueba", body: "", important: false, dueAt: null },
      createdBy: { uid: "local", displayName: "Local", email: "local@example.com" },
      source: "pwa",
      shortCode: "abc12345",
      shortUrl: "http://localhost/r/abc12345",
      createdAt: now,
    },
    job: {
      jobId: "22222222-2222-4222-8222-222222222222",
      requestId: "11111111-1111-4111-8111-111111111111",
      printerId: "home",
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
    event: {
      eventId: "33333333-3333-4333-8333-333333333333",
      requestId: "11111111-1111-4111-8111-111111111111",
      jobId: "22222222-2222-4222-8222-222222222222",
      occurredAt: now,
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
  return rm(directory, { recursive: true, force: true });
});

describe("FileRepository", () => {
  it("deduplica el comando y conserva los mismos IDs", async () => {
    const repository = new FileRepository(directory);
    expect((await repository.createRequestGraph(graph)).created).toBe(true);
    const duplicate = await repository.createRequestGraph({ ...graph, request: { ...graph.request, requestId: crypto.randomUUID() } });
    expect(duplicate.created).toBe(false);
    expect(duplicate.request.requestId).toBe(graph.request.requestId);
  });

  it("ignora una segunda entrega después de completar el render", async () => {
    const repository = new FileRepository(directory);
    await repository.createRequestGraph(graph);
    expect(await repository.beginRender(graph.event)).not.toBeNull();
    await repository.completeRender(graph.job.jobId, graph.event.eventId, { previewPath: "preview", escposPath: "escpos" });
    expect(await repository.beginRender(graph.event)).toBeNull();
    expect(await repository.getJob(graph.job.jobId)).toMatchObject({ status: "queued" });
  });

  it("recupera un lease abandonado cuando caduca", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-22T10:00:00.000Z"));
    const repository = new FileRepository(directory);
    await repository.createRequestGraph(graph);
    expect(await repository.beginRender(graph.event)).not.toBeNull();
    const redelivery = { ...graph.event, eventId: "44444444-4444-4444-8444-444444444444" };
    expect(await repository.beginRender(redelivery)).toBeNull();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(await repository.beginRender(redelivery)).not.toBeNull();
  });

  it("libera el lease tras un error para permitir reintentos", async () => {
    const repository = new FileRepository(directory);
    await repository.createRequestGraph(graph);
    expect(await repository.beginRender(graph.event)).not.toBeNull();
    await repository.failRender(graph.job.jobId, graph.event.eventId, "storage_unavailable");
    expect(await repository.beginRender(graph.event)).not.toBeNull();
    expect(await repository.getJob(graph.job.jobId)).toMatchObject({ status: "rendering", error: "storage_unavailable" });
  });
});
