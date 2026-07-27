import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { RequestCreatedEvent } from "@printdesk/shared-models";
import type {
  ArtifactPaths,
  CreatedGraph,
  NotionSyncWork,
  PrinterHealthUpdate,
  RequestGraph,
  StoredNotionSync,
  StoredPrinterCheck,
  StoredPrinterHealth,
  StoredPaperRoll,
  StoredPrintJob,
  StoredRequest,
} from "./domain.js";
import type { ArtifactStore, PrintDeskRepository } from "./ports.js";

interface FileState {
  requests: Record<string, StoredRequest>;
  jobs: Record<string, StoredPrintJob>;
  commands: Record<string, RequestGraph>;
  printerChecks: Record<string, StoredPrinterCheck>;
  printerHealth: Record<string, StoredPrinterHealth>;
  paperRolls: Record<string, StoredPaperRoll>;
  notionSyncs: Record<string, StoredNotionSync>;
}

const emptyState = (): FileState => ({
  requests: {},
  jobs: {},
  commands: {},
  printerChecks: {},
  printerHealth: {},
  paperRolls: {},
  notionSyncs: {},
});

export class FileRepository implements PrintDeskRepository {
  private readonly statePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.statePath = join(resolve(root), "state.json");
  }

  private async load(): Promise<FileState> {
    try {
      const stored = JSON.parse(await readFile(this.statePath, "utf8")) as Partial<FileState>;
      return {
        ...emptyState(),
        ...stored,
        printerChecks: stored.printerChecks ?? {},
        printerHealth: stored.printerHealth ?? {},
        paperRolls: stored.paperRolls ?? {},
        notionSyncs: stored.notionSyncs ?? {},
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyState();
      throw error;
    }
  }

  private async save(state: FileState) {
    await mkdir(dirname(this.statePath), { recursive: true });
    await writeFile(this.statePath, JSON.stringify(state, null, 2), "utf8");
  }

  private locked<T>(operation: (state: FileState) => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const state = await this.load();
      const value = await operation(state);
      await this.save(state);
      return value;
    });
    this.queue = result.catch(() => undefined);
    return result;
  }

  createRequestGraph(graph: RequestGraph): Promise<CreatedGraph> {
    return this.locked(async (state) => {
      const existing = state.commands[graph.commandId];
      if (existing) return { ...existing, created: false };
      state.requests[graph.request.requestId] = graph.request;
      state.jobs[graph.job.jobId] = graph.job;
      state.commands[graph.commandId] = graph;
      return { ...graph, created: true };
    });
  }

  async getJob(jobId: string) {
    return (await this.load()).jobs[jobId] ?? null;
  }

  async getJobByRequestId(requestId: string) {
    const state = await this.load();
    return Object.values(state.jobs).find((job) => job.requestId === requestId) ?? null;
  }

  async getRequest(requestId: string) {
    return (await this.load()).requests[requestId] ?? null;
  }

  async getRequestByShortCode(shortCode: string) {
    const state = await this.load();
    return Object.values(state.requests).find((request) => request.shortCode === shortCode) ?? null;
  }

  async getNotionSync(requestId: string) {
    return (await this.load()).notionSyncs[requestId] ?? null;
  }

  async listRequestsByOwner(uid: string, limit: number) {
    const state = await this.load();
    const jobsByRequest = new Map(Object.values(state.jobs).map((job) => [job.requestId, job]));
    return Object.values(state.requests)
      .filter((request) => request.createdBy.uid === uid)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit)
      .flatMap((request) => {
        const job = jobsByRequest.get(request.requestId);
        return job ? [{ request, job }] : [];
      });
  }

  createPrinterCheck(check: StoredPrinterCheck) {
    return this.locked(async (state) => {
      state.printerChecks[check.checkId] = check;
      return { ...check };
    });
  }

  async getPrinterCheck(checkId: string) {
    return (await this.load()).printerChecks[checkId] ?? null;
  }

  async getLatestPrinterCheck(uid: string, printerId: string) {
    const state = await this.load();
    return Object.values(state.printerChecks)
      .filter((check) => check.requestedBy.uid === uid && check.printerId === printerId)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0] ?? null;
  }

  claimPrinterCheck(checkId: string) {
    return this.locked(async (state) => {
      const check = state.printerChecks[checkId];
      if (!check || !["pending", "checking"].includes(check.status)) return null;
      if (check.status === "checking") return { ...check };
      Object.assign(check, { status: "checking", updatedAt: new Date().toISOString() });
      return { ...check };
    });
  }

  completePrinterCheck(checkId: string, available: boolean, error: string | null) {
    return this.locked(async (state) => {
      const check = state.printerChecks[checkId];
      if (!check || !["pending", "checking"].includes(check.status)) return null;
      Object.assign(check, {
        status: available ? "available" : "unavailable",
        error,
        updatedAt: new Date().toISOString(),
      });
      return { ...check };
    });
  }

  async getPrinterHealth(printerId: string) {
    return (await this.load()).printerHealth[printerId] ?? null;
  }

  updatePrinterHealth(printerId: string, update: PrinterHealthUpdate) {
    return this.locked(async (state) => {
      const now = new Date().toISOString();
      const current = state.printerHealth[printerId];
      const health: StoredPrinterHealth = {
        printerId,
        agentStatus: update.agentStatus ?? current?.agentStatus ?? "unknown",
        printerStatus: update.printerStatus ?? current?.printerStatus ?? "unknown",
        source: update.source,
        error: update.error === undefined ? current?.error ?? null : update.error,
        lastAgentSeenAt: update.agentStatus === "online" ? now : current?.lastAgentSeenAt ?? null,
        lastPrinterSeenAt: update.printerStatus === "available" ? now : current?.lastPrinterSeenAt ?? null,
        updatedAt: now,
      };
      state.printerHealth[printerId] = health;
      return { ...health };
    });
  }

  async getPaperRoll(printerId: string) {
    return (await this.load()).paperRolls[printerId] ?? null;
  }

  replacePaperRoll(printerId: string, lengthMm: number, actor: StoredPaperRoll["changedBy"]) {
    return this.locked(async (state) => {
      const now = new Date().toISOString();
      const roll: StoredPaperRoll = {
        printerId,
        lengthMm,
        usedMm: 0,
        printedTickets: 0,
        changedBy: actor,
        changedAt: now,
        updatedAt: now,
      };
      state.paperRolls[printerId] = roll;
      return { ...roll };
    });
  }

  beginNotionSync(event: RequestCreatedEvent): Promise<NotionSyncWork | null> {
    return this.locked(async (state) => {
      const request = state.requests[event.requestId];
      if (!request) throw new Error("notion_request_not_found");
      const existing = state.notionSyncs[event.requestId];
      if (existing?.status === "ready") return null;
      const now = new Date();
      const leaseActive = existing?.leaseExpiresAt && new Date(existing.leaseExpiresAt) > now;
      if (existing?.status === "syncing" && leaseActive) return null;
      const sync: StoredNotionSync = {
        requestId: event.requestId,
        status: "syncing",
        pageId: existing?.pageId ?? null,
        pageUrl: existing?.pageUrl ?? null,
        error: null,
        leaseEventId: event.eventId,
        leaseExpiresAt: new Date(now.getTime() + 5 * 60_000).toISOString(),
        createdAt: existing?.createdAt ?? now.toISOString(),
        updatedAt: now.toISOString(),
      };
      state.notionSyncs[event.requestId] = sync;
      return { request, sync: { ...sync }, event };
    });
  }

  completeNotionSync(
    requestId: string,
    eventId: string,
    page: { pageId: string; pageUrl: string },
  ) {
    return this.locked(async (state) => {
      const sync = state.notionSyncs[requestId];
      if (!sync || sync.status !== "syncing" || sync.leaseEventId !== eventId) throw new Error("notion_lease_lost");
      Object.assign(sync, page, {
        status: "ready",
        error: null,
        leaseEventId: null,
        leaseExpiresAt: null,
        updatedAt: new Date().toISOString(),
      });
      return { ...sync };
    });
  }

  failNotionSync(requestId: string, eventId: string, error: string) {
    return this.locked(async (state) => {
      const sync = state.notionSyncs[requestId];
      if (sync?.status === "syncing" && sync.leaseEventId === eventId) {
        Object.assign(sync, {
          status: "failed",
          error,
          leaseEventId: null,
          leaseExpiresAt: null,
          updatedAt: new Date().toISOString(),
        });
      }
    });
  }

  beginRender(event: RequestCreatedEvent) {
    return this.locked(async (state) => {
      const job = state.jobs[event.jobId];
      const request = state.requests[event.requestId];
      const now = new Date();
      const leaseActive = job?.renderLeaseExpiresAt && new Date(job.renderLeaseExpiresAt) > now;
      if (!job || !request || job.status !== "rendering" || leaseActive) return null;
      job.renderLeaseEventId = event.eventId;
      job.renderLeaseExpiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
      job.updatedAt = now.toISOString();
      return { request, job: { ...job }, event };
    });
  }

  completeRender(jobId: string, eventId: string, artifacts: ArtifactPaths) {
    return this.locked(async (state) => {
      const job = state.jobs[jobId];
      if (!job || job.status !== "rendering" || job.renderLeaseEventId !== eventId) throw new Error("render_lease_lost");
      Object.assign(job, artifacts, { status: "queued", error: null, renderLeaseEventId: null, renderLeaseExpiresAt: null, updatedAt: new Date().toISOString() });
      return { ...job };
    });
  }

  failRender(jobId: string, eventId: string, error: string) {
    return this.locked(async (state) => {
      const job = state.jobs[jobId];
      if (job?.status === "rendering" && job.renderLeaseEventId === eventId) {
        Object.assign(job, { error, renderLeaseEventId: null, renderLeaseExpiresAt: null, updatedAt: new Date().toISOString() });
      }
    });
  }

  claimJob(jobId: string) {
    return this.locked(async (state) => {
      const job = state.jobs[jobId];
      if (!job || job.status !== "queued") return null;
      Object.assign(job, { status: "claimed", attempts: job.attempts + 1, updatedAt: new Date().toISOString() });
      return { ...job };
    });
  }

  updatePrintStatus(jobId: string, status: "checking_printer" | "printing") {
    return this.locked(async (state) => {
      const job = state.jobs[jobId];
      if (!job) return null;
      if (job.status === status) return { ...job };
      const expected = status === "checking_printer" ? "claimed" : "checking_printer";
      if (job.status !== expected) return null;
      Object.assign(job, { status, updatedAt: new Date().toISOString() });
      return { ...job };
    });
  }

  completePrint(jobId: string, outcome: "printed" | "printed_simulated") {
    return this.locked(async (state) => {
      const job = state.jobs[jobId];
      if (!job) return null;
      const accountPaper = () => {
        if (outcome !== "printed" || job.paperAccountedAt) return;
        const now = new Date().toISOString();
        const roll = state.paperRolls[job.printerId];
        const paperLengthMm = job.paperLengthMm ?? 0;
        if (roll && paperLengthMm > 0) {
          roll.usedMm += paperLengthMm;
          roll.printedTickets += 1;
          roll.updatedAt = now;
        }
        job.paperAccountedAt = now;
      };
      if (job.status === outcome) {
        accountPaper();
        return { ...job };
      }
      if (job.status === "failed" && job.error?.startsWith("complete_failed")) {
        Object.assign(job, { status: outcome, error: null, updatedAt: new Date().toISOString() });
        accountPaper();
        return { ...job };
      }
      if (job.status !== "printing") return null;
      Object.assign(job, { status: outcome, error: null, updatedAt: new Date().toISOString() });
      accountPaper();
      return { ...job };
    });
  }

  failPrint(jobId: string, error: string, retryable: boolean) {
    return this.locked(async (state) => {
      const job = state.jobs[jobId];
      if (!job || !["claimed", "checking_printer", "printing"].includes(job.status)) return null;
      Object.assign(job, {
        status: retryable ? "queued" : "failed",
        error,
        updatedAt: new Date().toISOString(),
      });
      return { ...job };
    });
  }
}

export class FileArtifactStore implements ArtifactStore {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(requestId: string, preview: Buffer, escpos: Buffer) {
    const directory = join(this.root, "print-jobs", requestId);
    await mkdir(directory, { recursive: true });
    const previewPath = join(directory, "preview.png");
    const escposPath = join(directory, "ticket.escpos");
    await Promise.all([writeFile(previewPath, preview), writeFile(escposPath, escpos)]);
    return { previewPath, escposPath };
  }

  read(path: string) {
    const resolved = resolve(path);
    if (!resolved.startsWith(this.root)) throw new Error("artifact_path_outside_root");
    return readFile(resolved);
  }
}
