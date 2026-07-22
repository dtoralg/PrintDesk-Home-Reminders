import { describe, expect, it } from "vitest";
import { FirestoreRepository, GcsArtifactStore, PubSubEventPublisher, RenderWorker, type RequestGraph } from "../src/index.js";

const enabled = process.env.PRINTDESK_RUN_EMULATOR_TESTS === "true";
const projectId = process.env.GOOGLE_CLOUD_PROJECT ?? "printdesk-local";

describe.skipIf(!enabled)("Google Cloud emulators", () => {
  it("persiste, publica, renderiza y deduplica", async () => {
    const repository = new FirestoreRepository(projectId);
    const artifacts = new GcsArtifactStore(projectId, process.env.PRINTDESK_STORAGE_BUCKET ?? `${projectId}.appspot.com`);
    const publisher = new PubSubEventPublisher(projectId, process.env.PRINTDESK_REQUEST_CREATED_TOPIC ?? "request-created");
    const worker = new RenderWorker(repository, artifacts);
    const requestId = crypto.randomUUID();
    const jobId = crypto.randomUUID();
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const graph: RequestGraph = {
      commandId: crypto.randomUUID(),
      request: {
        requestId,
        input: { type: "task", title: "Prueba de emuladores", body: "Firestore, Pub/Sub y Storage", important: true, dueAt: null },
        createdBy: { uid: "emulator", displayName: "Emulator", email: "emulator@example.com" },
        source: "pwa",
        shortCode: "emulator1",
        shortUrl: "http://localhost:8080/r/emulator1",
        createdAt: now,
      },
      job: {
        jobId,
        requestId,
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
      event: { eventId, requestId, jobId, occurredAt: now },
    };
    await repository.createRequestGraph(graph);
    expect(await publisher.publish(graph.event)).toBeTruthy();
    expect(await worker.handle(graph.event)).toBe("rendered");
    expect(await worker.handle(graph.event)).toBe("duplicate");
    const job = await repository.getJob(jobId);
    expect(job).toMatchObject({ status: "queued" });
    expect((await artifacts.read(job!.escposPath!)).length).toBeGreaterThan(1_000);
  }, 30_000);
});
