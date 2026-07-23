import { z } from "zod";

export const requestTypeSchema = z.enum(["task", "idea", "reminder", "note"]);
export type RequestType = z.infer<typeof requestTypeSchema>;

export const requestInputSchema = z
  .object({
    type: requestTypeSchema,
    title: z.string().trim().min(1).max(120),
    body: z.string().trim().max(2_000).default(""),
    important: z.boolean().default(false),
    dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
  })
  .strict();
export type RequestInput = z.infer<typeof requestInputSchema>;

export const createRequestCommandSchema = z
  .object({
    request: requestInputSchema,
    printerId: z.string().trim().min(1).max(80).default("home"),
    source: z.enum(["pwa", "mcp"]),
  })
  .strict();
export type CreateRequestCommand = z.infer<typeof createRequestCommandSchema>;

export const createdBySchema = z.object({
  uid: z.string().min(1),
  displayName: z.string().min(1),
  email: z.email(),
});
export type CreatedBy = z.infer<typeof createdBySchema>;

export const printJobStatusSchema = z.enum([
  "rendering",
  "queued",
  "claimed",
  "checking_printer",
  "printing",
  "printed",
  "printed_simulated",
  "failed",
]);
export type PrintJobStatus = z.infer<typeof printJobStatusSchema>;

export interface PrintJobView {
  jobId: string;
  requestId: string;
  printerId: string;
  status: PrintJobStatus;
  previewUrl: string | null;
  attempts: number;
  error: string | null;
  updatedAt: string;
}

export const requestCreatedEventSchema = z.object({
  eventId: z.uuid(),
  requestId: z.uuid(),
  jobId: z.uuid(),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type RequestCreatedEvent = z.infer<typeof requestCreatedEventSchema>;

export const printJobReadyEventSchema = z.object({
  eventId: z.uuid(),
  jobId: z.uuid(),
  printerId: z.string().trim().min(1).max(80),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type PrintJobReadyEvent = z.infer<typeof printJobReadyEventSchema>;

export interface CreateRequestResult {
  requestId: string;
  job: PrintJobView;
  notion: NotionSyncView;
  shortCode: string;
  shortUrl: string;
}

export const notionSyncStatusSchema = z.enum(["pending", "syncing", "ready", "failed"]);
export type NotionSyncStatus = z.infer<typeof notionSyncStatusSchema>;

export interface NotionSyncView {
  status: NotionSyncStatus;
  url: string | null;
  error: string | null;
  updatedAt: string | null;
}

export interface RequestStateResult {
  requestId: string;
  job: PrintJobView;
  notion: NotionSyncView;
  shortUrl: string;
}

export interface RequestHistoryItem {
  requestId: string;
  shortUrl: string;
  request: RequestInput;
  createdAt: string;
  job: PrintJobView;
  notion: NotionSyncView;
}

export interface RequestHistoryResult {
  items: RequestHistoryItem[];
}

export const printerCheckStatusSchema = z.enum(["pending", "checking", "available", "unavailable"]);
export type PrinterCheckStatus = z.infer<typeof printerCheckStatusSchema>;

export interface PrinterCheckView {
  checkId: string;
  printerId: string;
  status: PrinterCheckStatus;
  error: string | null;
  requestedAt: string;
  updatedAt: string;
}

export const printerCheckRequestedEventSchema = z.object({
  eventId: z.uuid(),
  checkId: z.uuid(),
  printerId: z.string().trim().min(1).max(80),
  occurredAt: z.iso.datetime({ offset: true }),
});
export type PrinterCheckRequestedEvent = z.infer<typeof printerCheckRequestedEventSchema>;
