import { FileArtifactStore, FileRepository } from "./file-adapters.js";
import { FirestoreRepository } from "./firestore-repository.js";
import {
  GcsArtifactStore,
  PubSubEventPublisher,
  PubSubPrinterCheckPublisher,
  PubSubPrintJobReadyPublisher,
} from "./gcp-adapters.js";
import type {
  ArtifactStore,
  EventPublisher,
  PrinterCheckPublisher,
  PrintDeskRepository,
} from "./ports.js";
import { InlineEventPublisher, RenderWorker } from "./render-worker.js";
import { HttpNotionPageWriter } from "./notion-adapter.js";
import { NotionWorker } from "./notion-worker.js";

export interface BackendDependencies {
  repository: PrintDeskRepository;
  artifacts: ArtifactStore;
  events: EventPublisher;
  printerChecks: PrinterCheckPublisher;
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
      printerChecks: new PubSubPrinterCheckPublisher(
        projectId,
        process.env.PRINTDESK_PRINTER_CHECK_TOPIC ?? "printer-check-requested",
      ),
    };
  }
  const repository = new FileRepository(dataDir);
  const artifacts = new FileArtifactStore(`${dataDir}/artifacts`);
  return {
    repository,
    artifacts,
    events: new InlineEventPublisher(new RenderWorker(repository, artifacts)),
    printerChecks: { publish: async (event) => event.eventId },
  };
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

export function createNotionDependencies() {
  const projectId = required("GOOGLE_CLOUD_PROJECT");
  const repository = new FirestoreRepository(projectId, process.env.PRINTDESK_FIRESTORE_DATABASE ?? "(default)");
  const pages = new HttpNotionPageWriter(
    required("PRINTDESK_NOTION_TOKEN"),
    required("PRINTDESK_NOTION_PARENT_PAGE_ID"),
  );
  return { repository, pages, worker: new NotionWorker(repository, pages) };
}
