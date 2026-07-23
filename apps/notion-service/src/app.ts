import Fastify from "fastify";
import { requestCreatedEventSchema } from "@printdesk/shared-models";
import type { NotionWorker } from "@printdesk/backend";

export function buildNotionApp(worker: Pick<NotionWorker, "handle">) {
  const app = Fastify({ logger: process.env.NODE_ENV !== "test" });
  app.get("/health", async () => ({ status: "ok" }));
  app.post("/events/request-created", async (request, reply) => {
    const envelope = request.body as { message?: { data?: string; messageId?: string } };
    if (!envelope.message?.data) return reply.code(400).send({ error: "invalid_pubsub_envelope" });
    let decoded: unknown;
    try {
      decoded = JSON.parse(Buffer.from(envelope.message.data, "base64").toString("utf8"));
    } catch {
      return reply.code(400).send({ error: "invalid_event_encoding" });
    }
    const event = requestCreatedEventSchema.safeParse(decoded);
    if (!event.success) return reply.code(400).send({ error: "invalid_event", issues: event.error.issues });
    const outcome = await worker.handle(event.data);
    if (outcome === "busy") return reply.code(503).send({ error: "notion_sync_busy" });
    return reply.code(204).header("x-printdesk-outcome", outcome).send();
  });
  return app;
}
