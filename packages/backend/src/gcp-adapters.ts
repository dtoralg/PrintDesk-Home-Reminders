import { PubSub } from "@google-cloud/pubsub";
import { getApps, initializeApp, type App } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import type {
  PrinterCheckRequestedEvent,
  PrintJobReadyEvent,
  RequestCreatedEvent,
} from "@printdesk/shared-models";
import type {
  ArtifactStore,
  EventPublisher,
  PrinterCheckPublisher,
  PrintJobReadyPublisher,
} from "./ports.js";

export class PubSubEventPublisher implements EventPublisher {
  private client: PubSub | undefined;
  constructor(private readonly projectId: string, private readonly topicId: string) {}

  private pubsub() {
    return (this.client ??= new PubSub({ projectId: this.projectId }));
  }

  publish(event: RequestCreatedEvent) {
    return this.pubsub().topic(this.topicId).publishMessage({
      json: event,
      attributes: { eventType: "request.created", schemaVersion: "1" },
    });
  }
}

export class PubSubPrintJobReadyPublisher implements PrintJobReadyPublisher {
  private client: PubSub | undefined;
  constructor(private readonly projectId: string, private readonly topicId: string) {}

  private pubsub() {
    return (this.client ??= new PubSub({ projectId: this.projectId }));
  }

  publish(event: PrintJobReadyEvent) {
    return this.pubsub().topic(this.topicId).publishMessage({
      json: event,
      attributes: {
        eventType: "print-job.ready",
        schemaVersion: "1",
        printerId: event.printerId,
      },
    });
  }
}

export class PubSubPrinterCheckPublisher implements PrinterCheckPublisher {
  private client: PubSub | undefined;
  constructor(private readonly projectId: string, private readonly topicId: string) {}

  private pubsub() {
    return (this.client ??= new PubSub({ projectId: this.projectId }));
  }

  publish(event: PrinterCheckRequestedEvent) {
    return this.pubsub().topic(this.topicId).publishMessage({
      json: event,
      attributes: {
        eventType: "printer-check.requested",
        schemaVersion: "1",
        printerId: event.printerId,
      },
    });
  }
}

export class GcsArtifactStore implements ArtifactStore {
  private app: App | undefined;
  constructor(private readonly projectId: string, private readonly bucketName: string) {}

  private bucket() {
    if (!this.app) {
      const name = `printdesk-storage-${this.projectId}`;
      this.app = getApps().find((candidate) => candidate.name === name)
        ?? initializeApp({ projectId: this.projectId, storageBucket: this.bucketName }, name);
    }
    return getStorage(this.app).bucket(this.bucketName);
  }

  private async putImmutable(path: string, data: Buffer, contentType: string) {
    try {
      await this.bucket().file(path).save(data, {
        resumable: false,
        contentType,
        metadata: { cacheControl: "private, max-age=31536000, immutable" },
        preconditionOpts: { ifGenerationMatch: 0 },
      });
    } catch (error) {
      if ((error as { code?: number }).code !== 412) throw error;
    }
  }

  async put(requestId: string, preview: Buffer, escpos: Buffer) {
    const previewPath = `print-jobs/${requestId}/preview.png`;
    const escposPath = `print-jobs/${requestId}/ticket.escpos`;
    await Promise.all([
      this.putImmutable(previewPath, preview, "image/png"),
      this.putImmutable(escposPath, escpos, "application/octet-stream"),
    ]);
    return { previewPath, escposPath };
  }

  async read(path: string) {
    const [contents] = await this.bucket().file(path).download();
    return contents;
  }
}
