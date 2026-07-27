import type { NotionSyncView, PrintJobView, RequestInput } from "@printdesk/shared-models";

export type AppSection = "home" | "compose" | "history" | "printer" | "settings";
export type CreationMode = "simple" | "advanced";

export interface TicketDraft extends RequestInput {
  dueLocal: string;
  interpretedByAi?: boolean;
}

export interface ActiveTicket {
  requestId: string;
  shortUrl: string;
  draft: TicketDraft;
  job: PrintJobView;
  notion: NotionSyncView;
  interpretedByAi?: boolean;
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
