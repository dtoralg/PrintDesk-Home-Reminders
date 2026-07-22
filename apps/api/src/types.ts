import type { CreatedBy, PrintJobStatus, RequestInput } from "@printdesk/shared-models";

export interface StoredRequest {
  requestId: string;
  input: RequestInput;
  createdBy: CreatedBy;
  source: "pwa" | "mcp";
  shortCode: string;
  shortUrl: string;
  createdAt: string;
}

export interface StoredPrintJob {
  jobId: string;
  requestId: string;
  printerId: string;
  status: PrintJobStatus;
  previewPath: string | null;
  escposPath: string | null;
  attempts: number;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}
