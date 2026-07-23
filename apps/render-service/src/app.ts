import Fastify from "fastify";
import { requestCreatedEventSchema } from "@printdesk/shared-models";
import type { RenderWorker } from "@printdesk/backend";

export function buildRenderApp(worker: Pick<RenderWorker, "handle">) {
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
    return reply.code(204).header("x-printdesk-outcome", outcome).send();
  });
  return app;
}
