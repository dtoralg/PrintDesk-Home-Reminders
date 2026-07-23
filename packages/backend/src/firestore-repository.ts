import { Firestore } from "@google-cloud/firestore";
import type { RequestCreatedEvent } from "@printdesk/shared-models";
import type {
  ArtifactPaths,
  CreatedGraph,
  NotionSyncWork,
  RequestGraph,
  StoredNotionSync,
  StoredPrinterCheck,
  StoredPrintJob,
  StoredRequest,
} from "./domain.js";
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

  async getJobByRequestId(requestId: string) {
    const snapshots = await this.db().collection("print_jobs").where("requestId", "==", requestId).limit(1).get();
    return snapshots.empty ? null : snapshots.docs[0]!.data() as StoredPrintJob;
  }

  async getRequest(requestId: string) {
    const snapshot = await this.db().doc(`requests/${requestId}`).get();
    return snapshot.exists ? (snapshot.data() as StoredRequest) : null;
  }

  async getRequestByShortCode(shortCode: string) {
    const snapshots = await this.db().collection("requests").where("shortCode", "==", shortCode).limit(1).get();
    return snapshots.empty ? null : snapshots.docs[0]!.data() as StoredRequest;
  }

  async getNotionSync(requestId: string) {
    const snapshot = await this.db().doc(`notion_syncs/${requestId}`).get();
    return snapshot.exists ? snapshot.data() as StoredNotionSync : null;
  }

  async listRequestsByOwner(uid: string, limit: number) {
    const requestSnapshots = await this.db().collection("requests").where("createdBy.uid", "==", uid).get();
    const requests = requestSnapshots.docs
      .map((snapshot) => snapshot.data() as StoredRequest)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, limit);
    if (!requests.length) return [];
    const jobSnapshots = await this.db()
      .collection("print_jobs")
      .where("requestId", "in", requests.map((request) => request.requestId))
      .get();
    const jobsByRequest = new Map(
      jobSnapshots.docs.map((snapshot) => {
        const job = snapshot.data() as StoredPrintJob;
        return [job.requestId, job] as const;
      }),
    );
    return requests.flatMap((request) => {
      const job = jobsByRequest.get(request.requestId);
      return job ? [{ request, job }] : [];
    });
  }

  async createPrinterCheck(check: StoredPrinterCheck) {
    await this.db().doc(`printer_checks/${check.checkId}`).create(check);
    return check;
  }

  async getPrinterCheck(checkId: string) {
    const snapshot = await this.db().doc(`printer_checks/${checkId}`).get();
    return snapshot.exists ? snapshot.data() as StoredPrinterCheck : null;
  }

  async getLatestPrinterCheck(uid: string, printerId: string) {
    const snapshots = await this.db()
      .collection("printer_checks")
      .where("requestedBy.uid", "==", uid)
      .get();
    return snapshots.docs
      .map((snapshot) => snapshot.data() as StoredPrinterCheck)
      .filter((check) => check.printerId === printerId)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0] ?? null;
  }

  claimPrinterCheck(checkId: string) {
    return this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`printer_checks/${checkId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const check = snapshot.data() as StoredPrinterCheck;
      if (!["pending", "checking"].includes(check.status)) return null;
      if (check.status === "checking") return check;
      const updated = { ...check, status: "checking" as const, updatedAt: new Date().toISOString() };
      transaction.set(ref, updated);
      return updated;
    });
  }

  completePrinterCheck(checkId: string, available: boolean, error: string | null) {
    return this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`printer_checks/${checkId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const check = snapshot.data() as StoredPrinterCheck;
      if (!["pending", "checking"].includes(check.status)) return null;
      const updated = {
        ...check,
        status: available ? "available" as const : "unavailable" as const,
        error,
        updatedAt: new Date().toISOString(),
      };
      transaction.set(ref, updated);
      return updated;
    });
  }

  beginNotionSync(event: RequestCreatedEvent): Promise<NotionSyncWork | null> {
    return this.db().runTransaction(async (transaction) => {
      const requestRef = this.db().doc(`requests/${event.requestId}`);
      const syncRef = this.db().doc(`notion_syncs/${event.requestId}`);
      const [requestSnapshot, syncSnapshot] = await Promise.all([
        transaction.get(requestRef),
        transaction.get(syncRef),
      ]);
      if (!requestSnapshot.exists) throw new Error("notion_request_not_found");
      const existing = syncSnapshot.exists ? syncSnapshot.data() as StoredNotionSync : null;
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
      transaction.set(syncRef, sync);
      return {
        request: requestSnapshot.data() as StoredRequest,
        sync,
        event,
      };
    });
  }

  completeNotionSync(
    requestId: string,
    eventId: string,
    page: { pageId: string; pageUrl: string },
  ) {
    return this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`notion_syncs/${requestId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("notion_sync_not_found");
      const sync = snapshot.data() as StoredNotionSync;
      if (sync.status !== "syncing" || sync.leaseEventId !== eventId) throw new Error("notion_lease_lost");
      const updated: StoredNotionSync = {
        ...sync,
        ...page,
        status: "ready",
        error: null,
        leaseEventId: null,
        leaseExpiresAt: null,
        updatedAt: new Date().toISOString(),
      };
      transaction.set(ref, updated);
      return updated;
    });
  }

  async failNotionSync(requestId: string, eventId: string, error: string) {
    await this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`notion_syncs/${requestId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return;
      const sync = snapshot.data() as StoredNotionSync;
      if (sync.status === "syncing" && sync.leaseEventId === eventId) {
        transaction.update(ref, {
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

  updatePrintStatus(jobId: string, status: "checking_printer" | "printing") {
    return this.db().runTransaction(async (transaction) => {
      const ref = this.db().doc(`print_jobs/${jobId}`);
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) return null;
      const job = snapshot.data() as StoredPrintJob;
      if (job.status === status) return job;
      const expected = status === "checking_printer" ? "claimed" : "checking_printer";
      if (job.status !== expected) return null;
      const updated = { ...job, status, updatedAt: new Date().toISOString() };
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
      if (job.status !== "printing") return null;
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
      if (!["claimed", "checking_printer", "printing"].includes(job.status)) return null;
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
