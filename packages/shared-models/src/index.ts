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

export interface CreateRequestResult {
  requestId: string;
  job: PrintJobView;
  shortCode: string;
  shortUrl: string;
}
