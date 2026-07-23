import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileRepository, type ArtifactStore, type EventPublisher, type RequestGraph } from "@printdesk/backend";
import { buildApp } from "../src/app.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "printdesk-api-"));
  process.env.PRINTDESK_ALLOW_DEV_AUTH = "true";
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("API contract", () => {
  it("rejects identity and status fields supplied by a client", async () => {
    const app = await buildApp({ dataDir: directory });
    const response = await app.inject({
      method: "POST",
      url: "/v1/requests",
      payload: {
        request: { type: "task", title: "No válida", createdBy: { uid: "spoofed" } },
        printerId: "home",
        source: "pwa",
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("fails closed when development authentication is disabled", async () => {
    delete process.env.PRINTDESK_ALLOW_DEV_AUTH;
    const app = await buildApp({ dataDir: directory });
    const response = await app.inject({
      method: "POST",
      url: "/v1/requests",
      payload: { request: { type: "task", title: "Privada" }, printerId: "home", source: "pwa" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("devuelve el historial real del usuario autenticado", async () => {
    const repository = new FileRepository(directory);
    const now = "2026-07-23T18:00:00.000Z";
    const graph = {
      commandId: "history-command",
      request: {
        requestId: "11111111-1111-4111-8111-111111111111",
        input: {
          type: "task",
          title: "Revisar la póliza",
          body: "Detalle <script>alert(1)</script>",
          important: true,
          dueAt: null,
        },
        createdBy: { uid: "local-user", displayName: "Usuario local", email: "local@printdesk.test" },
        source: "pwa",
        shortCode: "history1",
        shortUrl: "http://localhost:8080/r/history1",
        createdAt: now,
      },
      job: {
        jobId: "22222222-2222-4222-8222-222222222222",
        requestId: "11111111-1111-4111-8111-111111111111",
        printerId: "home",
        status: "printed",
        previewPath: null,
        escposPath: null,
        attempts: 1,
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
    } satisfies RequestGraph;
    await repository.createRequestGraph(graph);
    await repository.beginNotionSync(graph.event);
    await repository.completeNotionSync(graph.request.requestId, graph.event.eventId, {
      pageId: "notion-page-1",
      pageUrl: "https://www.notion.so/notion-page-1",
    });
    const app = await buildApp({
      repository,
      artifacts: {} as ArtifactStore,
      events: {} as EventPublisher,
      publicBaseUrl: "http://localhost:8080",
    });

    const response = await app.inject({ method: "GET", url: "/v1/requests?limit=20" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{
        requestId: graph.request.requestId,
        request: { title: "Revisar la póliza" },
        job: { jobId: graph.job.jobId, status: "printed" },
        notion: { status: "ready", url: "https://www.notion.so/notion-page-1" },
      }],
    });
    const state = await app.inject({ method: "GET", url: `/v1/requests/${graph.request.requestId}` });
    expect(state.statusCode).toBe(200);
    expect(state.json()).toMatchObject({
      requestId: graph.request.requestId,
      job: { status: "printed" },
      notion: { status: "ready", url: "https://www.notion.so/notion-page-1" },
    });
    const redirect = await app.inject({ method: "GET", url: "/r/history1" });
    expect(redirect.statusCode).toBe(302);
    expect(redirect.headers.location).toBe("https://www.notion.so/notion-page-1");
    const liveTicket = await app.inject({ method: "GET", url: "/r/history1?view=live" });
    expect(liveTicket.statusCode).toBe(200);
    expect(liveTicket.headers["content-type"]).toContain("text/html");
    expect(liveTicket.body).toContain("Revisar la póliza");
    expect(liveTicket.body).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(liveTicket.body).not.toContain("<script>alert(1)</script>");
    await app.close();
  });

  it("expone al cliente todos los estados reales reportados por el agente", async () => {
    const repository = new FileRepository(directory);
    const now = "2026-07-23T18:00:00.000Z";
    const graph = {
      commandId: "print-lifecycle-command",
      request: {
        requestId: "11111111-1111-4111-8111-111111111112",
        input: { type: "task", title: "Imprimir estados", body: "", important: false, dueAt: null },
        createdBy: { uid: "local-user", displayName: "Usuario local", email: "local@printdesk.test" },
        source: "pwa",
        shortCode: "states01",
        shortUrl: "http://localhost:8080/r/states01",
        createdAt: now,
      },
      job: {
        jobId: "22222222-2222-4222-8222-222222222223",
        requestId: "11111111-1111-4111-8111-111111111112",
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
        eventId: "33333333-3333-4333-8333-333333333334",
        requestId: "11111111-1111-4111-8111-111111111112",
        jobId: "22222222-2222-4222-8222-222222222223",
        occurredAt: now,
      },
    } satisfies RequestGraph;
    await repository.createRequestGraph(graph);
    await repository.beginRender(graph.event);
    await repository.completeRender(graph.job.jobId, graph.event.eventId, {
      previewPath: "preview.png",
      escposPath: "ticket.escpos",
    });
    const app = await buildApp({
      repository,
      artifacts: {
        put: async () => ({ previewPath: "preview.png", escposPath: "ticket.escpos" }),
        read: async () => Buffer.from("ticket"),
      },
      events: { publish: async () => "message-1" },
      publicBaseUrl: "http://localhost:8080",
    });

    expect((await app.inject({ method: "POST", url: `/v1/print-jobs/${graph.job.jobId}/claim` })).json())
      .toMatchObject({ artifactUrl: `/v1/print-jobs/${graph.job.jobId}/artifact` });
    const checking = await app.inject({
      method: "POST",
      url: `/v1/print-jobs/${graph.job.jobId}/status`,
      payload: { status: "checking_printer" },
    });
    expect(checking.json()).toMatchObject({ status: "checking_printer" });
    const printing = await app.inject({
      method: "POST",
      url: `/v1/print-jobs/${graph.job.jobId}/status`,
      payload: { status: "printing" },
    });
    expect(printing.json()).toMatchObject({ status: "printing" });
    const completed = await app.inject({
      method: "POST",
      url: `/v1/print-jobs/${graph.job.jobId}/complete`,
      payload: { outcome: "printed" },
    });
    expect(completed.json()).toMatchObject({ status: "printed" });
    await app.close();
  });

  it("conserva una comprobación de impresora hasta que responde el agente", async () => {
    const app = await buildApp({ dataDir: directory });
    const created = await app.inject({ method: "POST", url: "/v1/printers/home/checks" });
    expect(created.statusCode).toBe(202);
    const pending = created.json() as { checkId: string; status: string };
    expect(pending.status).toBe("pending");

    const claimed = await app.inject({
      method: "POST",
      url: `/v1/printer-checks/${pending.checkId}/claim`,
    });
    expect(claimed.statusCode).toBe(200);
    expect(claimed.json()).toMatchObject({ status: "checking" });

    const completed = await app.inject({
      method: "POST",
      url: `/v1/printer-checks/${pending.checkId}/complete`,
      payload: { available: true, error: null },
    });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ status: "available", error: null });

    const read = await app.inject({ method: "GET", url: `/v1/printer-checks/${pending.checkId}` });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ checkId: pending.checkId, status: "available" });
    const latest = await app.inject({ method: "GET", url: "/v1/printers/home/checks/latest" });
    expect(latest.statusCode).toBe(200);
    expect(latest.json()).toMatchObject({ checkId: pending.checkId, status: "available" });
    await app.close();
  });
});
