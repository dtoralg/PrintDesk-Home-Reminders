import { describe, expect, it, vi } from "vitest";
import { buildNotionApp } from "../src/app.js";

const event = {
  eventId: "33333333-3333-4333-8333-333333333333",
  requestId: "11111111-1111-4111-8111-111111111111",
  jobId: "22222222-2222-4222-8222-222222222222",
  occurredAt: "2026-07-23T18:00:00.000Z",
};

describe("Notion Pub/Sub push endpoint", () => {
  it("expone salud para Cloud Run", async () => {
    const app = buildNotionApp({ handle: vi.fn() });
    expect((await app.inject({ method: "GET", url: "/health" })).json()).toEqual({ status: "ok" });
    await app.close();
  });

  it("decodifica el evento y confirma una copia terminada", async () => {
    const handle = vi.fn().mockResolvedValue("synced");
    const app = buildNotionApp({ handle });
    const response = await app.inject({
      method: "POST",
      url: "/events/request-created",
      payload: { message: { data: Buffer.from(JSON.stringify(event)).toString("base64") } },
    });
    expect(response.statusCode).toBe(204);
    expect(handle).toHaveBeenCalledWith(event);
    await app.close();
  });

  it("fuerza reintento mientras otro lease sigue activo", async () => {
    const app = buildNotionApp({ handle: vi.fn().mockResolvedValue("busy") });
    const response = await app.inject({
      method: "POST",
      url: "/events/request-created",
      payload: { message: { data: Buffer.from(JSON.stringify(event)).toString("base64") } },
    });
    expect(response.statusCode).toBe(503);
    await app.close();
  });
});
