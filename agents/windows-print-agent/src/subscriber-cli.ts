import { PubSub, type Message } from "@google-cloud/pubsub";
import { GoogleAuth } from "google-auth-library";
import { printJobReadyEventSchema } from "@printdesk/shared-models";
import { runTcpJob } from "./index.js";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing_environment_variable:${name}`);
  return value;
}

const projectId = required("GOOGLE_CLOUD_PROJECT");
const subscriptionId = required("PRINTDESK_AGENT_SUBSCRIPTION");
const apiBaseUrl = required("PRINTDESK_API_BASE_URL");
const audience = process.env.PRINTDESK_DEVICE_TOKEN_AUDIENCE?.trim() || apiBaseUrl.replace(/\/$/, "");
const printerId = process.env.PRINTDESK_PRINTER_ID?.trim() || "home";
const printerHost = required("PRINTDESK_PRINTER_HOST");
const printerPort = Number.parseInt(process.env.PRINTDESK_PRINTER_PORT ?? "9100", 10);
const spoolDirectory = process.env.PRINTDESK_SPOOL_DIRECTORY?.trim() || ".local-data/agent-spool";
if (!Number.isInteger(printerPort) || printerPort < 1 || printerPort > 65_535) throw new Error("invalid_printer_port");

const auth = new GoogleAuth();
const idTokenClient = await auth.getIdTokenClient(audience);
const authorization = async () => {
  const headers = await idTokenClient.getRequestHeaders();
  const value = headers.get("authorization");
  if (!value) throw new Error("device_identity_token_unavailable");
  return value;
};

const pubsub = new PubSub({ projectId });
const subscription = pubsub.subscription(subscriptionId, {
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
  if (event.data.printerId !== printerId) {
    console.log(`Trabajo ${event.data.jobId} dirigido a ${event.data.printerId}; agente ${printerId} lo ignora.`);
    message.ack();
    return;
  }
  try {
    const result = await runTcpJob(apiBaseUrl, event.data.jobId, {
      host: printerHost,
      port: printerPort,
      settleBeforeCutMs: 1_500,
      settleAfterWriteMs: 750,
    }, { spoolDirectory, authorization });
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

subscription.on("message", (message) => void handle(message));
subscription.on("error", (error) => console.error("Error de suscripción Pub/Sub:", error));
console.log(`Agente PrintDesk escuchando ${subscriptionId}; impresora tcp://${printerHost}:${printerPort}`);

async function stop() {
  if (stopping) return;
  stopping = true;
  await subscription.close();
  await pubsub.close();
}

process.once("SIGINT", () => void stop().finally(() => process.exit(0)));
process.once("SIGTERM", () => void stop().finally(() => process.exit(0)));
