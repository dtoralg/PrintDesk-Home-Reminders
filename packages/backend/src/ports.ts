import type { PrintJobStatus, RequestCreatedEvent } from "@printdesk/shared-models";
import type {
  ArtifactPaths,
  CreatedGraph,
  RenderWork,
  RequestGraph,
  StoredPrintJob,
  StoredRequest,
} from "./domain.js";

export interface PrintDeskRepository {
  createRequestGraph(graph: RequestGraph): Promise<CreatedGraph>;
  getRequest(requestId: string): Promise<StoredRequest | null>;
  getJob(jobId: string): Promise<StoredPrintJob | null>;
  beginRender(event: RequestCreatedEvent): Promise<RenderWork | null>;
  completeRender(jobId: string, eventId: string, artifacts: ArtifactPaths): Promise<StoredPrintJob>;
  failRender(jobId: string, eventId: string, error: string): Promise<void>;
  claimJob(jobId: string): Promise<StoredPrintJob | null>;
  completePrint(jobId: string, outcome: Extract<PrintJobStatus, "printed" | "printed_simulated">): Promise<StoredPrintJob | null>;
  failPrint(jobId: string, error: string, retryable: boolean): Promise<StoredPrintJob | null>;
}

export interface ArtifactStore {
  put(requestId: string, preview: Buffer, escpos: Buffer): Promise<ArtifactPaths>;
  read(path: string): Promise<Buffer>;
}

export interface EventPublisher {
  publish(event: RequestCreatedEvent): Promise<string>;
}
