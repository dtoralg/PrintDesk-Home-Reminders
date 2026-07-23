import { describe, expect, it, vi } from "vitest";
import type { NotionPageWriter, PrintDeskRepository } from "./ports.js";
import { NotionWorker } from "./notion-worker.js";

const event = {
  eventId: "33333333-3333-4333-8333-333333333333",
  requestId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-07-23T18:00:00.000Z",
};

const request = {
  requestId: event.requestId,
  input: { type: "task", title: "Póliza", body: "", important: false, dueAt: null },
  createdBy: { uid: "user-1", displayName: "Dani", email: "dani@example.com" },
  source: "pwa",
  shortCode: "abc12345",
  shortUrl: "https://printdesk.example/r/abc12345",
  createdAt: event.occurredAt,
} as const;

describe("NotionWorker", () => {
  it("crea una sola página y completa el redirect", async () => {
    const repository = {
      getNotionSync: vi.fn().mockResolvedValue(null),
      beginNotionSync: vi.fn().mockResolvedValue({
        request,
        event,
        sync: { requestId: request.requestId, status: "syncing" },
      }),
      completeNotionSync: vi.fn().mockResolvedValue({ status: "ready" }),
      failNotionSync: vi.fn(),
    } as unknown as PrintDeskRepository;
    const pages = {
      createPage: vi.fn().mockResolvedValue({
        pageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        pageUrl: "https://www.notion.so/page",
      }),
    } satisfies NotionPageWriter;

    await expect(new NotionWorker(repository, pages).handle(event)).resolves.toBe("synced");
    expect(repository.completeNotionSync).toHaveBeenCalledWith(request.requestId, event.eventId, {
      pageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      pageUrl: "https://www.notion.so/page",
    });
  });

  it("confirma sin duplicar cuando la copia ya está lista", async () => {
    const repository = {
      getNotionSync: vi.fn().mockResolvedValue({ status: "ready" }),
      beginNotionSync: vi.fn(),
    } as unknown as PrintDeskRepository;
    const pages = { createPage: vi.fn() } satisfies NotionPageWriter;
    await expect(new NotionWorker(repository, pages).handle(event)).resolves.toBe("duplicate");
    expect(repository.beginNotionSync).not.toHaveBeenCalled();
    expect(pages.createPage).not.toHaveBeenCalled();
  });
});
