import type {
  InterpretTicketResult,
  PrinterCheckRequestedEvent,
  PrintJobReadyEvent,
  PrintJobStatus,
  RequestCreatedEvent,
} from "@printdesk/shared-models";
import type {
  ArtifactPaths,
  CreatedGraph,
  NotionSyncWork,
  RenderWork,
  RequestHistoryEntry,
  PrinterHealthUpdate,
  StoredPrinterCheck,
  StoredPrinterHealth,
  StoredPaperRoll,
  StoredNotionSync,
  RequestGraph,
  StoredPrintJob,
  StoredRequest,
} from "./domain.js";

export interface PrintDeskRepository {
  createRequestGraph(graph: RequestGraph): Promise<CreatedGraph>;
  getRequest(requestId: string): Promise<StoredRequest | null>;
  getRequestByShortCode(shortCode: string): Promise<StoredRequest | null>;
  getNotionSync(requestId: string): Promise<StoredNotionSync | null>;
  getJob(jobId: string): Promise<StoredPrintJob | null>;
  getJobByRequestId(requestId: string): Promise<StoredPrintJob | null>;
  listRequestsByOwner(uid: string, limit: number): Promise<RequestHistoryEntry[]>;
  createPrinterCheck(check: StoredPrinterCheck): Promise<StoredPrinterCheck>;
  getPrinterCheck(checkId: string): Promise<StoredPrinterCheck | null>;
  getLatestPrinterCheck(uid: string, printerId: string): Promise<StoredPrinterCheck | null>;
  claimPrinterCheck(checkId: string): Promise<StoredPrinterCheck | null>;
  completePrinterCheck(checkId: string, available: boolean, error: string | null): Promise<StoredPrinterCheck | null>;
  getPrinterHealth(printerId: string): Promise<StoredPrinterHealth | null>;
  updatePrinterHealth(printerId: string, update: PrinterHealthUpdate): Promise<StoredPrinterHealth>;
  getPaperRoll(printerId: string): Promise<StoredPaperRoll | null>;
  replacePaperRoll(printerId: string, lengthMm: number, actor: StoredPaperRoll["changedBy"]): Promise<StoredPaperRoll>;
  beginNotionSync(event: RequestCreatedEvent): Promise<NotionSyncWork | null>;
  completeNotionSync(
    requestId: string,
    eventId: string,
    page: { pageId: string; pageUrl: string },
  ): Promise<StoredNotionSync>;
  failNotionSync(requestId: string, eventId: string, error: string): Promise<void>;
  beginRender(event: RequestCreatedEvent): Promise<RenderWork | null>;
  completeRender(jobId: string, eventId: string, artifacts: ArtifactPaths): Promise<StoredPrintJob>;
  failRender(jobId: string, eventId: string, error: string): Promise<void>;
  claimJob(jobId: string): Promise<StoredPrintJob | null>;
  updatePrintStatus(
    jobId: string,
    status: Extract<PrintJobStatus, "checking_printer" | "printing">,
  ): Promise<StoredPrintJob | null>;
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

export interface PrintJobReadyPublisher {
  publish(event: PrintJobReadyEvent): Promise<string>;
}

export interface PrinterCheckPublisher {
  publish(event: PrinterCheckRequestedEvent): Promise<string>;
}

export interface NotionPageWriter {
  createPage(request: StoredRequest): Promise<{ pageId: string; pageUrl: string }>;
}

export interface TicketInterpreter {
  interpret(text: string, context: { now: string; timeZone: string }): Promise<InterpretTicketResult>;
}
