import { PubSub, type Message } from "@google-cloud/pubsub";
import { GoogleAuth } from "google-auth-library";
import {
  printerCheckRequestedEventSchema,
  printJobReadyEventSchema,
} from "@printdesk/shared-models";
import { loadAgentConfig, installFileLogger } from "./config.js";
import { runPrinterCheck, runTcpJob } from "./index.js";

async function main() {
  const config = loadAgentConfig();
  installFileLogger(config.logPath);
  process.env.GOOGLE_APPLICATION_CREDENTIALS = config.credentialsPath;

  const auth = new GoogleAuth();
  const idTokenClient = await auth.getIdTokenClient(config.audience);
  const authorization = async () => {
    const headers = await idTokenClient.getRequestHeaders();
    const value = headers.get("authorization");
    if (!value) throw new Error("device_identity_token_unavailable");
    return value;
  };

  const pubsub = new PubSub({ projectId: config.projectId });
  const subscription = pubsub.subscription(config.subscriptionId, {
    flowControl: { maxMessages: 1, allowExcessMessages: false },
  });
  const checkSubscription = pubsub.subscription(config.printerCheckSubscriptionId, {
    flowControl: { maxMessages: 1, allowExcessMessages: false },
  });
  let stopping = false;

  async function handle(message: Message) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(message.data.toString("utf8"));
    } catch {
      console.error("Mensaje Pub/Sub no contiene JSON válido; se confirma para evitar un bucle.");
      message.ack();
      return;
    }
    const event = printJobReadyEventSchema.safeParse(decoded);
    if (!event.success) {
      console.error("Evento print-job.ready inválido; se confirma para evitar un bucle.", event.error.issues);
      message.ack();
      return;
    }
    if (event.data.printerId !== config.printerId) {
      console.log(`Trabajo ${event.data.jobId} dirigido a ${event.data.printerId}; agente ${config.printerId} lo ignora.`);
      message.ack();
      return;
    }
    try {
      const result = await runTcpJob(config.apiBaseUrl, event.data.jobId, {
        host: config.printerHost,
        port: config.printerPort,
        settleBeforeCutMs: 1_500,
        settleAfterWriteMs: 750,
      }, { spoolDirectory: config.spoolDirectory, authorization });
      console.log(JSON.stringify({
        jobId: event.data.jobId,
        status: "printed",
        bytesWritten: result.bytesWritten,
        spoolPath: result.spoolPath,
      }));
      message.ack();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      if (detail.startsWith("claim_failed (409)")) {
        console.log(`Trabajo ${event.data.jobId} ya procesado o reclamado; mensaje confirmado.`);
        message.ack();
        return;
      }
      console.error(`Falló el trabajo ${event.data.jobId}: ${detail}`);
      message.nack();
    }
  }

  async function handlePrinterCheck(message: Message) {
    let decoded: unknown;
    try {
      decoded = JSON.parse(message.data.toString("utf8"));
    } catch {
      console.error("Mensaje de comprobación no contiene JSON válido; se confirma para evitar un bucle.");
      message.ack();
      return;
    }
    const event = printerCheckRequestedEventSchema.safeParse(decoded);
    if (!event.success) {
      console.error("Evento printer-check.requested inválido; se confirma para evitar un bucle.", event.error.issues);
      message.ack();
      return;
    }
    if (event.data.printerId !== config.printerId) {
      console.log(`Comprobación ${event.data.checkId} dirigida a ${event.data.printerId}; agente ${config.printerId} la ignora.`);
      message.ack();
      return;
    }
    try {
      const result = await runPrinterCheck(
        config.apiBaseUrl,
        event.data.checkId,
        {
          host: config.printerHost,
          port: config.printerPort,
          connectAttempts: 2,
          connectTimeoutMs: 1_500,
        },
        { authorization },
      );
      if (!result) {
        console.log(`Comprobación ${event.data.checkId} ya resuelta; se confirma la reentrega.`);
        message.ack();
        return;
      }
      console.log(JSON.stringify({
        checkId: event.data.checkId,
        status: result.status,
        error: result.error,
      }));
      message.ack();
    } catch (error) {
      console.error(`Falló la comprobación ${event.data.checkId}: ${error instanceof Error ? error.message : String(error)}`);
      message.nack();
    }
  }

  subscription.on("message", (message) => void handle(message));
  subscription.on("error", (error) => console.error("Error de suscripción Pub/Sub:", error));
  checkSubscription.on("message", (message) => void handlePrinterCheck(message));
  checkSubscription.on("error", (error) => console.error("Error de suscripción de comprobaciones:", error));
  console.log(
    `Agente PrintDesk escuchando ${config.subscriptionId} y ${config.printerCheckSubscriptionId}; impresora tcp://${config.printerHost}:${config.printerPort}`,
  );

  async function stop() {
    if (stopping) return;
    stopping = true;
    await Promise.all([subscription.close(), checkSubscription.close()]);
    await pubsub.close();
  }

  process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
  process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
