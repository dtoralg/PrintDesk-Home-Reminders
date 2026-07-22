import { describe, expect, it, vi } from "vitest";
import { buildRenderApp } from "../src/app.js";

const event = {
  eventId: "33333333-3333-4333-8333-333333333333",
  requestId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-07-22T10:00:00.000Z",
};

describe("Pub/Sub push endpoint", () => {
  it("decodifica y entrega un evento válido", async () => {
    const handle = vi.fn().mockResolvedValue("rendered");
    const app = buildRenderApp({ handle });
    const response = await app.inject({
      method: "POST",
      url: "/events/request-created",
      payload: { message: { messageId: "message-1", data: Buffer.from(JSON.stringify(event)).toString("base64") } },
    });
    expect(response.statusCode).toBe(204);
    expect(handle).toHaveBeenCalledWith(event);
    await app.close();
  });

  it("rechaza un sobre corrupto para que Pub/Sub no lo confirme", async () => {
    const handle = vi.fn();
    const app = buildRenderApp({ handle });
    const response = await app.inject({ method: "POST", url: "/events/request-created", payload: { message: { data: "%%%" } } });
    expect(response.statusCode).toBe(400);
    expect(handle).not.toHaveBeenCalled();
    await app.close();
  });
});
