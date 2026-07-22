import { Firestore } from "@google-cloud/firestore";
import type { RequestCreatedEvent } from "@printdesk/shared-models";
import type { ArtifactPaths, CreatedGraph, RequestGraph, StoredPrintJob, StoredRequest } from "./domain.js";
import type { PrintDeskRepository } from "./ports.js";

export class FirestoreRepository implements PrintDeskRepository {
  private firestore: Firestore | undefined;
  constructor(private readonly projectId: string, private readonly databaseId = "(default)") {}

  private db() {
    return (this.firestore ??= new Firestore({ projectId: this.projectId, databaseId: this.databaseId }));
  }

  async createRequestGraph(graph: RequestGraph): Promise<CreatedGraph> {
    return this.db().runTransaction(async (transaction) => {
      const commandRef = this.db().doc(`commands/${graph.commandId}`);
      const existing = await transaction.get(commandRef);
      if (existing.exists) return { ...(existing.data() as RequestGraph), created: false };
      transaction.create(this.db().doc(`requests/${graph.request.requestId}`), graph.request);
      transaction.create(this.db().doc(`print_jobs/${graph.job.jobId}`), graph.job);
      transaction.create(commandRef, graph);
      return { ...graph, created: true };
    });
  }

  async getJob(jobId: string) {
    const snapshot = await this.db().doc(`print_jobs/${jobId}`).get();
    return snapshot.exists ? (snapshot.data() as StoredPrintJob) : null;
  }

  beginRender(event: RequestCreatedEvent) {
    return this.db().runTransaction(async (transaction) => {
      const jobRef = this.db().doc(`print_jobs/${event.jobId}`);
      const requestRef = this.db().doc(`requests/${event.requestId}`);
      const [jobSnapshot, requestSnapshot] = await Promise.all([transaction.get(jobRef), transaction.get(requestRef)]);
      if (!jobSnapshot.exists || !requestSnapshot.exists) throw new Error("render_subject_not_found");
      const job = jobSnapshot.data() as StoredPrintJob;
      const now = new Date();
      const leaseActive = job.renderLeaseExpiresAt && new Date(job.renderLeaseExpiresAt) > now;
      if (job.status !== "rendering" || leaseActive) return null;
      const updatedAt = now.toISOString();
      const renderLeaseExpiresAt = new Date(now.getTime() + 5 * 60_000).toISOString();
      transaction.update(jobRef, { renderLeaseEventId: event.eventId, renderLeaseExpiresAt, updatedAt });
      return {
        request: requestSnapshot.data() as StoredRequest,
        job: { ...job, renderLeaseEventId: event.eventId, renderLeaseExpiresAt, updatedAt },
        event,
      };
    });
  }

  completeRender(jobId: string, eventId: string, artifacts: ArtifactPaths) {
    return this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`print_jobs/${jobId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("job_not_found");
      const job = snapshot.data() as StoredPrintJob;
      if (job.status !== "rendering" || job.renderLeaseEventId !== eventId) throw new Error("render_lease_lost");
      const updated = { ...job, ...artifacts, status: "queued" as const, error: null, renderLeaseEventId: null, renderLeaseExpiresAt: null, updatedAt: new Date().toISOString() };
      transaction.set(ref, updated);
      return updated;
    });
  }

  async failRender(jobId: string, eventId: string, error: string) {
    await this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`print_jobs/${jobId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const job = snapshot.data() as StoredPrintJob;
      if (job.status === "rendering" && job.renderLeaseEventId === eventId) {
        transaction.update(ref, { error, renderLeaseEventId: null, renderLeaseExpiresAt: null, updatedAt: new Date().toISOString() });
      }
    });
  }

  claimJob(jobId: string) {
    return this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`print_jobs/${jobId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const job = snapshot.data() as StoredPrintJob;
      if (job.status !== "queued") return null;
      const updated = { ...job, status: "claimed" as const, attempts: job.attempts + 1, updatedAt: new Date().toISOString() };
      transaction.set(ref, updated);
      return updated;
    });
  }

  completePrint(jobId: string, outcome: "printed" | "printed_simulated") {
    return this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`print_jobs/${jobId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const job = snapshot.data() as StoredPrintJob;
      if (job.status !== "claimed") return null;
      const updated = { ...job, status: outcome, updatedAt: new Date().toISOString() };
      transaction.set(ref, updated);
      return updated;
    });
  }

  failPrint(jobId: string, error: string, retryable: boolean) {
    return this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`print_jobs/${jobId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const job = snapshot.data() as StoredPrintJob;
      if (job.status !== "claimed") return null;
      const updated = {
        ...job,
        status: retryable ? "queued" as const : "failed" as const,
        error,
        updatedAt: new Date().toISOString(),
      };
      transaction.set(ref, updated);
      return updated;
    });
  }
}
