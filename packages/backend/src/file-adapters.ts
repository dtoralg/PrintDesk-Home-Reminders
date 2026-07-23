import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { RequestCreatedEvent } from "@printdesk/shared-models";
import type { ArtifactPaths, CreatedGraph, RequestGraph, StoredPrintJob, StoredRequest } from "./domain.js";
import type { ArtifactStore, PrintDeskRepository } from "./ports.js";

interface FileState {
  requests: Record<string, StoredRequest>;
  jobs: Record<string, StoredPrintJob>;
  commands: Record<string, RequestGraph>;
}

const emptyState = (): FileState => ({ requests: {}, jobs: {}, commands: {} });

export class FileRepository implements PrintDeskRepository {
  private readonly statePath: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(root: string) {
    this.statePath = join(resolve(root), "state.json");
  }

  private async load(): Promise<FileState> {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8")) as FileState;
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

  async getRequest(requestId: string) {
    return (await this.load()).requests[requestId] ?? null;
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

  completePrint(jobId: string, outcome: "printed" | "printed_simulated") {
    return this.locked(async (state) => {
      const job = state.jobs[jobId];
      if (!job || job.status !== "claimed") return null;
      Object.assign(job, { status: outcome, updatedAt: new Date().toISOString() });
      return { ...job };
    });
  }

  failPrint(jobId: string, error: string, retryable: boolean) {
    return this.locked(async (state) => {
      const job = state.jobs[jobId];
      if (!job || job.status !== "claimed") return null;
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
