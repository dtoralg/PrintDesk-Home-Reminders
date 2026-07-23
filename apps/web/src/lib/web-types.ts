import type { NotionSyncView, PrintJobView, RequestInput } from "@printdesk/shared-models";

export type AppSection = "home" | "compose" | "history" | "printer" | "settings";

export interface TicketDraft extends RequestInput {
  dueLocal: string;
}

export interface ActiveTicket {
  requestId: string;
  shortUrl: string;
  draft: TicketDraft;
  job: PrintJobView;
  notion: NotionSyncView;
}

export interface RecentTicket {
  requestId: string;
  jobId: string;
  shortUrl?: string;
  title: string;
  type: RequestInput["type"];
  status: PrintJobView["status"];
  important: boolean;
  updatedAt: string;
}
