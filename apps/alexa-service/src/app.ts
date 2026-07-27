import Fastify, { type FastifyRequest } from "fastify";
import { z } from "zod";
import type { RequestInput } from "@printdesk/shared-models";

const alexaEnvelopeSchema = z.object({
  session: z.object({
    application: z.object({ applicationId: z.string() }).passthrough(),
    user: z.object({ userId: z.string() }).passthrough(),
    attributes: z.record(z.string(), z.unknown()).optional(),
  }).passthrough().optional(),
  context: z.object({
    System: z.object({
      application: z.object({ applicationId: z.string() }).passthrough(),
      user: z.object({ userId: z.string() }).passthrough(),
      device: z.object({ deviceId: z.string() }).passthrough().optional(),
    }).passthrough(),
  }).passthrough(),
  request: z.object({
    type: z.string(),
    requestId: z.string().min(8).max(200),
    intent: z.object({
      name: z.string(),
      slots: z.record(z.string(), z.object({ value: z.string().optional() }).passthrough()).optional(),
    }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

interface ParsedAlexaBody {
  raw: string;
  value: unknown;
}

export interface AlexaRequestVerifier {
  verify(rawBody: string, headers: FastifyRequest["headers"]): Promise<void>;
}

export interface PrintDeskAlexaClient {
  createFromText(text: string, idempotencyKey: string): Promise<{ request: RequestInput }>;
}

export interface AlexaAppConfig {
  applicationId: string;
  allowedUserIds: ReadonlySet<string>;
  allowedDeviceIds: ReadonlySet<string>;
  requireConfirmation: boolean;
  rateLimitPerMinute: number;
}

interface RateEntry {
  count: number;
  expiresAt: number;
}

function speech(text: string, shouldEndSession: boolean, sessionAttributes: Record<string, unknown> = {}) {
  return {
    version: "1.0",
    sessionAttributes,
    response: {
      outputSpeech: { type: "PlainText", text },
      ...(shouldEndSession ? {} : {
        reprompt: {
          outputSpeech: {
            type: "PlainText",
            text: "Dime qué quieres imprimir.",
          },
        },
      }),
      shouldEndSession,
    },
  };
}

function elicitPrintContent() {
  return {
    version: "1.0",
    sessionAttributes: {},
    response: {
      outputSpeech: {
        type: "PlainText",
        text: "¿Qué quieres imprimir?",
      },
      directives: [
        {
          type: "Dialog.ElicitSlot",
          slotToElicit: "text",
          updatedIntent: {
            name: "CaptureIntent",
            confirmationStatus: "NONE",
            slots: {
              text: {
                name: "text",
                confirmationStatus: "NONE",
              },
            },
          },
        },
      ],
      shouldEndSession: false,
    },
  };
}

function textSlot(envelope: z.infer<typeof alexaEnvelopeSchema>) {
  return envelope.request.intent?.slots?.text?.value?.trim() ?? "";
}

function pendingSession(envelope: z.infer<typeof alexaEnvelopeSchema>) {
  const text = envelope.session?.attributes?.pendingText;
  const requestId = envelope.session?.attributes?.pendingRequestId;
  return typeof text === "string" && typeof requestId === "string"
    ? { text, requestId }
    : null;
}

export function buildAlexaApp(
  config: AlexaAppConfig,
  verifier: AlexaRequestVerifier,
  client: PrintDeskAlexaClient,
) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  const rateEntries = new Map<string, RateEntry>();
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    const raw = String(body);
    try {
      done(null, { raw, value: JSON.parse(raw) } satisfies ParsedAlexaBody);
    } catch (error) {
      done(error as Error);
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post("/integrations/alexa", async (request, reply) => {
    const body = request.body as ParsedAlexaBody;
    if (!body?.raw) return reply.code(400).send({ error: "invalid_alexa_body" });
    try {
      await verifier.verify(body.raw, request.headers);
    } catch {
      return reply.code(400).send({ error: "invalid_alexa_signature" });
    }
    const parsed = alexaEnvelopeSchema.safeParse(body.value);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_alexa_request" });
    const envelope = parsed.data;
    const system = envelope.context.System;
    const sessionApplicationId = envelope.session?.application.applicationId;
    const sessionUserId = envelope.session?.user.userId;
    if (system.application.applicationId !== config.applicationId
      || (sessionApplicationId && sessionApplicationId !== config.applicationId)) {
      return reply.code(403).send({ error: "alexa_application_not_allowed" });
    }
    if (!config.allowedUserIds.has(system.user.userId)
      || (sessionUserId && sessionUserId !== system.user.userId)) {
      return reply.code(403).send({ error: "alexa_user_not_allowed" });
    }
    const deviceId = system.device?.deviceId;
    if (config.allowedDeviceIds.size > 0 && (!deviceId || !config.allowedDeviceIds.has(deviceId))) {
      return reply.code(403).send({ error: "alexa_device_not_allowed" });
    }
    const rateKey = `${system.user.userId}:${deviceId ?? "unknown"}:${request.ip}`;
    const now = Date.now();
    const currentRate = rateEntries.get(rateKey);
    const nextRate = !currentRate || currentRate.expiresAt <= now
      ? { count: 1, expiresAt: now + 60_000 }
      : { count: currentRate.count + 1, expiresAt: currentRate.expiresAt };
    rateEntries.set(rateKey, nextRate);
    if (nextRate.count > config.rateLimitPerMinute) {
      return reply.code(429).send({ error: "alexa_rate_limited" });
    }

    const requestType = envelope.request.type;
    const intentName = envelope.request.intent?.name;
    if (requestType === "LaunchRequest") {
      return elicitPrintContent();
    }
    if (requestType === "SessionEndedRequest"
      || intentName === "AMAZON.StopIntent"
      || intentName === "AMAZON.CancelIntent"
      || intentName === "AMAZON.NoIntent") {
      return speech("De acuerdo.", true);
    }
    if (intentName === "AMAZON.HelpIntent") {
      return speech("Puedes decir, imprime que hay que comprar huevos, leche y pan.", false);
    }

    let command: { text: string; requestId: string } | null = null;
    if (requestType === "IntentRequest"
      && (intentName === "PrintIntent" || intentName === "NoteIntent" || intentName === "CaptureIntent")) {
      const slot = textSlot(envelope);
      if (!slot) return speech("No he entendido el contenido. Dime qué quieres imprimir.", false);
      const text = intentName === "NoteIntent" ? `Una nota sobre ${slot}` : slot;
      if (config.requireConfirmation) {
        return speech(`Voy a imprimir: ${text}. ¿Confirmas?`, false, {
          pendingText: text,
          pendingRequestId: envelope.request.requestId,
        });
      }
      command = { text, requestId: envelope.request.requestId };
    } else if (requestType === "IntentRequest" && intentName === "AMAZON.YesIntent") {
      command = pendingSession(envelope);
      if (!command) return speech("No hay ningún ticket pendiente de confirmación.", true);
    }
    if (!command) return speech("No he entendido la petición. Dime qué quieres imprimir.", false);

    try {
      const result = await client.createFromText(command.text, `alexa:${command.requestId}`);
      return speech(`He enviado a imprimir: ${result.request.title}.`, true);
    } catch (error) {
      request.log.error({ error, alexaRequestId: command.requestId }, "Unable to create Alexa ticket");
      return speech("No he podido enviar el ticket a PrintDesk. Inténtalo de nuevo en unos segundos.", true);
    }
  });

  return app;
}
