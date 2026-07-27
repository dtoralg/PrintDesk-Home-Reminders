import { describe, expect, it, vi } from "vitest";
import type { StoredPrintJob, StoredRequest } from "./domain.js";
import type { ArtifactStore, PrintDeskRepository, PrintJobReadyPublisher } from "./ports.js";
import { escPosPaperLengthMm, rendererPayload, RenderWorker } from "./render-worker.js";

const event = {
  eventId: "33333333-3333-4333-8333-333333333333",
  requestId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-07-23T16:00:00.000Z",
};

describe("RenderWorker ready events", () => {
  it("calcula la longitud física del raster más el avance de corte", () => {
    const bytes = Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x76, 0x30, 0x00, 72, 0, 80, 0]);
    expect(escPosPaperLengthMm(bytes)).toBe(22);
  });

  it("entrega al renderer el autor y la fecha de creación", () => {
    const request = {
      requestId: event.requestId,
      input: {
        type: "task",
        title: "Revisar la póliza",
        body: "Comprobar conexión y análisis",
        important: true,
        dueAt: null,
      },
      createdBy: { uid: "user-1", displayName: "Dani Loral", email: "dani@example.com" },
      source: "pwa",
      shortCode: "abc123",
      shortUrl: "https://printdesk.example/r/abc123",
      createdAt: "2026-07-23T16:00:00.000Z",
    } satisfies StoredRequest;

    expect(rendererPayload(request)).toEqual({
      request: request.input,
      shortUrl: request.shortUrl,
      createdBy: request.createdBy,
      createdAt: request.createdAt,
    });
  });

  it("republica print-job.ready cuando Pub/Sub reentrega un render ya completado", async () => {
    const job = {
      jobId: event.jobId,
      requestId: event.requestId,
      printerId: "home",
      status: "queued",
      updatedAt: "2026-07-23T16:01:00.000Z",
    } as StoredPrintJob;
    const repository = {
      beginRender: vi.fn().mockResolvedValue(null),
      getJob: vi.fn().mockResolvedValue(job),
    } as unknown as PrintDeskRepository;
    const readyEvents = { publish: vi.fn().mockResolvedValue("message-1") } satisfies PrintJobReadyPublisher;
    const worker = new RenderWorker(repository, {} as ArtifactStore, readyEvents);

    await expect(worker.handle(event)).resolves.toBe("duplicate");
    expect(readyEvents.publish).toHaveBeenCalledWith({
      eventId: event.jobId,
      jobId: event.jobId,
      printerId: "home",
      occurredAt: job.updatedAt,
    });
  });
});
