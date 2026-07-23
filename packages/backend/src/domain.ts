import type {
  CreatedBy,
  NotionSyncStatus,
  PrinterCheckStatus,
  PrintJobStatus,
  RequestCreatedEvent,
  RequestInput,
} from "@printdesk/shared-models";

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
  renderLeaseEventId: string | null;
  renderLeaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestGraph {
  commandId: string;
  request: StoredRequest;
  job: StoredPrintJob;
  event: RequestCreatedEvent;
}

export interface CreatedGraph extends RequestGraph {
  created: boolean;
}

export interface RenderWork {
  request: StoredRequest;
  job: StoredPrintJob;
  event: RequestCreatedEvent;
}

export interface RequestHistoryEntry {
  request: StoredRequest;
  job: StoredPrintJob;
}

export interface StoredPrinterCheck {
  checkId: string;
  printerId: string;
  requestedBy: CreatedBy;
  status: PrinterCheckStatus;
  error: string | null;
  requestedAt: string;
  updatedAt: string;
}

export interface StoredNotionSync {
  requestId: string;
  status: Exclude<NotionSyncStatus, "pending">;
  pageId: string | null;
  pageUrl: string | null;
  error: string | null;
  leaseEventId: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotionSyncWork {
  request: StoredRequest;
  sync: StoredNotionSync;
  event: RequestCreatedEvent;
}

export interface ArtifactPaths {
  previewPath: string;
  escposPath: string;
}
