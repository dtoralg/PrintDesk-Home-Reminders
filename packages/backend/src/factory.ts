import { FileArtifactStore, FileRepository } from "./file-adapters.js";
import { FirestoreRepository } from "./firestore-repository.js";
import { GcsArtifactStore, PubSubEventPublisher, PubSubPrintJobReadyPublisher } from "./gcp-adapters.js";
import type { ArtifactStore, EventPublisher, PrintDeskRepository } from "./ports.js";
import { InlineEventPublisher, RenderWorker } from "./render-worker.js";

export interface BackendDependencies {
  repository: PrintDeskRepository;
  artifacts: ArtifactStore;
  events: EventPublisher;
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`missing_environment_variable:${name}`);
  return value;
}

export function createApiDependencies(dataDir = process.env.PRINTDESK_DATA_DIR ?? ".local-data"): BackendDependencies {
  if (process.env.PRINTDESK_BACKEND === "gcp") {
    const projectId = required("GOOGLE_CLOUD_PROJECT");
    return {
      repository: new FirestoreRepository(projectId, process.env.PRINTDESK_FIRESTORE_DATABASE ?? "(default)"),
      artifacts: new GcsArtifactStore(projectId, required("PRINTDESK_STORAGE_BUCKET")),
      events: new PubSubEventPublisher(projectId, process.env.PRINTDESK_REQUEST_CREATED_TOPIC ?? "request-created"),
    };
  }
  const repository = new FileRepository(dataDir);
  const artifacts = new FileArtifactStore(`${dataDir}/artifacts`);
  return { repository, artifacts, events: new InlineEventPublisher(new RenderWorker(repository, artifacts)) };
}

export function createRenderDependencies() {
  const projectId = required("GOOGLE_CLOUD_PROJECT");
  const repository = new FirestoreRepository(projectId, process.env.PRINTDESK_FIRESTORE_DATABASE ?? "(default)");
  const artifacts = new GcsArtifactStore(projectId, required("PRINTDESK_STORAGE_BUCKET"));
  const readyEvents = new PubSubPrintJobReadyPublisher(
    projectId,
    process.env.PRINTDESK_PRINT_JOB_READY_TOPIC ?? "print-job-ready",
  );
  return { repository, artifacts, worker: new RenderWorker(repository, artifacts, readyEvents) };
}
