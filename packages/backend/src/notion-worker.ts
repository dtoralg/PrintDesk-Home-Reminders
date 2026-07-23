import type { RequestCreatedEvent } from "@printdesk/shared-models";
import type { NotionPageWriter, PrintDeskRepository } from "./ports.js";

export class NotionWorker {
  constructor(
    private readonly repository: PrintDeskRepository,
    private readonly pages: NotionPageWriter,
  ) {}

  async handle(event: RequestCreatedEvent): Promise<"synced" | "duplicate" | "busy"> {
    const existing = await this.repository.getNotionSync(event.requestId);
    if (existing?.status === "ready") return "duplicate";
    const work = await this.repository.beginNotionSync(event);
    if (!work) return "busy";
    try {
      const page = await this.pages.createPage(work.request);
      await this.repository.completeNotionSync(work.request.requestId, event.eventId, page);
      return "synced";
    } catch (error) {
      await this.repository.failNotionSync(
        work.request.requestId,
        event.eventId,
        error instanceof Error ? error.message : "notion_sync_failed",
      );
      throw error;
    }
  }
}
