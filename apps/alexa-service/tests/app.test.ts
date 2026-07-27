import { describe, expect, it, vi } from "vitest";
import { buildAlexaApp, type AlexaRequestVerifier, type PrintDeskAlexaClient } from "../src/app.js";

const verifier: AlexaRequestVerifier = { verify: async () => undefined };

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    version: "1.0",
    session: {
      application: { applicationId: "amzn1.ask.skill.printdesk" },
      user: { userId: "alexa-user-1" },
      attributes: {},
    },
    context: {
      System: {
        application: { applicationId: "amzn1.ask.skill.printdesk" },
        user: { userId: "alexa-user-1" },
        device: { deviceId: "echo-kitchen" },
      },
    },
    request: {
      type: "IntentRequest",
      requestId: "amzn1.echo-api.request.12345678",
      intent: {
        name: "PrintIntent",
        slots: { text: { name: "text", value: "que hay que comprar huevos, leche y pan" } },
      },
    },
    ...overrides,
  };
}

function config(requireConfirmation = false) {
  return {
    applicationId: "amzn1.ask.skill.printdesk",
    allowedUserIds: new Set(["alexa-user-1"]),
    allowedDeviceIds: new Set(["echo-kitchen"]),
    requireConfirmation,
    rateLimitPerMinute: 10,
  };
}

describe("Alexa adapter", () => {
  it("inicia el diálogo de dos turnos solicitando el contenido libre", async () => {
    const client = { createFromText: vi.fn<PrintDeskAlexaClient["createFromText"]>() };
    const app = buildAlexaApp(config(), verifier, client);
    const response = await app.inject({
      method: "POST",
      url: "/integrations/alexa",
      headers: { "content-type": "application/json" },
      payload: envelope({
        request: {
          type: "LaunchRequest",
          requestId: "amzn1.echo-api.request.launch123",
          locale: "es-ES",
        },
      }),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().response.directives).toEqual([
      expect.objectContaining({
        type: "Dialog.ElicitSlot",
        slotToElicit: "text",
        updatedIntent: expect.objectContaining({ name: "CaptureIntent" }),
      }),
    ]);
    expect(response.json().response.shouldEndSession).toBe(false);
    expect(client.createFromText).not.toHaveBeenCalled();
    await app.close();
  });

  it("verifica identidad, conserva requestId y envía texto libre a PrintDesk", async () => {
    const createFromText = vi.fn<PrintDeskAlexaClient["createFromText"]>(async () => ({
      request: {
        type: "task",
        title: "Comprar huevos, leche y pan",
        body: "Añadir huevos, leche y pan a la compra.",
        important: false,
        dueAt: null,
      },
    }));
    const app = buildAlexaApp(config(), verifier, { createFromText });
    const response = await app.inject({
      method: "POST",
      url: "/integrations/alexa",
      headers: { "content-type": "application/json" },
      payload: envelope(),
    });
    expect(response.statusCode).toBe(200);
    expect(createFromText).toHaveBeenCalledWith(
      "que hay que comprar huevos, leche y pan",
      "alexa:amzn1.echo-api.request.12345678",
    );
    expect(response.json().response.outputSpeech.text).toContain("Comprar huevos, leche y pan");
    await app.close();
  });

  it("rechaza firmas, aplicaciones, usuarios y dispositivos no autorizados", async () => {
    const client = { createFromText: vi.fn<PrintDeskAlexaClient["createFromText"]>() };
    const invalidSignature = buildAlexaApp(config(), {
      verify: async () => { throw new Error("invalid"); },
    }, client);
    expect((await invalidSignature.inject({
      method: "POST",
      url: "/integrations/alexa",
      payload: envelope(),
    })).statusCode).toBe(400);
    await invalidSignature.close();

    const app = buildAlexaApp(config(), verifier, client);
    const invalidDevice = envelope({
      context: {
        System: {
          application: { applicationId: "amzn1.ask.skill.printdesk" },
          user: { userId: "alexa-user-1" },
          device: { deviceId: "echo-unknown" },
        },
      },
    });
    expect((await app.inject({
      method: "POST",
      url: "/integrations/alexa",
      payload: invalidDevice,
    })).statusCode).toBe(403);
    expect(client.createFromText).not.toHaveBeenCalled();
    await app.close();
  });

  it("puede pedir confirmación sin imprimir hasta recibir AMAZON.YesIntent", async () => {
    const createFromText = vi.fn<PrintDeskAlexaClient["createFromText"]>(async () => ({
      request: {
        type: "note",
        title: "Evento de mañana",
        body: "Nota sobre el evento de mañana.",
        important: false,
        dueAt: null,
      },
    }));
    const app = buildAlexaApp(config(true), verifier, { createFromText });
    const pending = await app.inject({
      method: "POST",
      url: "/integrations/alexa",
      payload: envelope(),
    });
    expect(pending.json().response.shouldEndSession).toBe(false);
    expect(createFromText).not.toHaveBeenCalled();
    const confirmed = await app.inject({
      method: "POST",
      url: "/integrations/alexa",
      payload: envelope({
        session: {
          application: { applicationId: "amzn1.ask.skill.printdesk" },
          user: { userId: "alexa-user-1" },
          attributes: pending.json().sessionAttributes,
        },
        request: {
          type: "IntentRequest",
          requestId: "amzn1.echo-api.request.confirmation",
          intent: { name: "AMAZON.YesIntent", slots: {} },
        },
      }),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(createFromText).toHaveBeenCalledTimes(1);
    expect(createFromText.mock.calls[0]?.[1]).toBe("alexa:amzn1.echo-api.request.12345678");
    await app.close();
  });
});
