import { describe, expect, it, vi } from "vitest";
import { VertexTicketInterpreter } from "./ticket-interpreter.js";

describe("VertexTicketInterpreter", () => {
  it("devuelve únicamente un RequestInput validado", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              type: "reminder",
              title: "Comprar leche",
              body: "Comprar leche al salir del trabajo.",
              important: false,
              dueAt: "2026-07-28T12:00:00+02:00",
            }),
          }],
        },
      }],
    }), { status: 200 }));
    const interpreter = new VertexTicketInterpreter({
      projectId: "printdesk-test",
      accessToken: async () => "token",
      fetchImpl,
    });

    await expect(interpreter.interpret("Recuérdame comprar leche mañana", {
      now: "2026-07-27T18:00:00.000Z",
      timeZone: "Europe/Madrid",
    })).resolves.toMatchObject({
      request: { type: "reminder", title: "Comprar leche", important: false },
      model: "gemini-2.5-flash",
    });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(init.headers).toMatchObject({ authorization: "Bearer token" });
    expect(String(init.body)).toContain("Europe/Madrid");
  });

  it("rechaza una salida que no cumple el contrato del ticket", async () => {
    const interpreter = new VertexTicketInterpreter({
      projectId: "printdesk-test",
      accessToken: async () => "token",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: "{\"title\":\"\"}" }] } }],
      }), { status: 200 })),
    });
    await expect(interpreter.interpret("texto válido", {
      now: "2026-07-27T18:00:00.000Z",
      timeZone: "Europe/Madrid",
    })).rejects.toThrow("vertex_invalid_ticket");
  });
});
