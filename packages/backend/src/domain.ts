import type {
  AgentHealthStatus,
  CreatedBy,
  NotionSyncStatus,
  PrinterHealthStatus,
  PrinterCheckStatus,
  PrintJobStatus,
  RequestCreatedEvent,
  RequestInput,
} from "@printdesk/shared-models";

export interface StoredRequest {
  requestId: string;
  input: RequestInput;
  createdBy: CreatedBy;
  source: "pwa" | "mcp" | "alexa";
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
  paperLengthMm?: number | null;
  paperAccountedAt?: string | null;
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
  source?: "startup_check" | "manual_check";
  status: PrinterCheckStatus;
  error: string | null;
  requestedAt: string;
  updatedAt: string;
}

export interface StoredPrinterHealth {
  printerId: string;
  agentStatus: AgentHealthStatus;
  printerStatus: PrinterHealthStatus;
  source: "startup_check" | "manual_check" | "print";
  error: string | null;
  lastAgentSeenAt: string | null;
  lastPrinterSeenAt: string | null;
  updatedAt: string;
}

export interface PrinterHealthUpdate {
  agentStatus?: AgentHealthStatus;
  printerStatus?: PrinterHealthStatus;
  source: StoredPrinterHealth["source"];
  error?: string | null;
}

export interface StoredPaperRoll {
  printerId: string;
  lengthMm: number;
  usedMm: number;
  printedTickets: number;
  changedBy: CreatedBy;
  changedAt: string;
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
  paperLengthMm?: number;
}
