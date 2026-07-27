import { requestInputSchema, type InterpretTicketResult } from "@printdesk/shared-models";
import type { TicketInterpreter } from "./ports.js";

interface VertexTicketInterpreterOptions {
  projectId: string;
  location?: string;
  model?: string;
  accessToken: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

const responseSchema = {
  type: "OBJECT",
  properties: {
    type: {
      type: "STRING",
      enum: ["task", "idea", "reminder", "note"],
      description: "task para acciones, idea para ideas, reminder para avisos con fecha y note para información.",
    },
    title: { type: "STRING", description: "Título de entre 1 y 120 caracteres." },
    body: { type: "STRING", description: "Descripción de hasta 2000 caracteres." },
    important: { type: "BOOLEAN" },
    dueAt: {
      type: "STRING",
      format: "date-time",
      nullable: true,
    },
  },
  required: ["type", "title", "body", "important", "dueAt"],
} as const;

function instructions(now: string, timeZone: string) {
  return [
    "Convierte el mensaje en un ticket doméstico de PrintDesk.",
    "No inventes nombres, fechas, lugares ni detalles que el usuario no haya dado.",
    "El título debe ser breve, claro, accionable y estar en el idioma del usuario.",
    "El cuerpo conserva los detalles útiles sin repetir el título.",
    "Marca important=true solo si hay urgencia, prioridad o importancia explícita.",
    "Usa reminder si el propósito principal es recordar algo con fecha; task para una acción; idea para una idea; note para información.",
    "Si no existe ninguna fecha explícita o relativa, dueAt debe ser null.",
    `Fecha y hora actuales: ${now}. Zona horaria: ${timeZone}.`,
    "Para fechas sin hora, usa las 12:00 en la zona indicada y devuelve RFC 3339 con offset.",
  ].join("\n");
}

interface VertexResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
}

export class VertexTicketInterpreter implements TicketInterpreter {
  private readonly location: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: VertexTicketInterpreterOptions) {
    this.location = options.location ?? "global";
    this.model = options.model ?? "gemini-2.5-flash";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async interpret(text: string, context: { now: string; timeZone: string }): Promise<InterpretTicketResult> {
    const endpoint = [
      "https://aiplatform.googleapis.com/v1/projects",
      encodeURIComponent(this.options.projectId),
      "locations",
      encodeURIComponent(this.location),
      "publishers/google/models",
      `${encodeURIComponent(this.model)}:generateContent`,
    ].join("/");
    const response = await this.fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await this.options.accessToken()}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: instructions(context.now, context.timeZone) }],
        },
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
          responseMimeType: "application/json",
          responseSchema,
        },
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      throw new Error(`vertex_generate_failed (${response.status}): ${detail}`);
    }
    const payload = await response.json() as VertexResponse;
    const generated = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();
    if (!generated) throw new Error("vertex_empty_response");
    let parsed: unknown;
    try {
      parsed = JSON.parse(generated);
    } catch {
      throw new Error("vertex_invalid_json");
    }
    const request = requestInputSchema.safeParse(parsed);
    if (!request.success) throw new Error(`vertex_invalid_ticket: ${request.error.issues[0]?.message ?? "invalid"}`);
    return { request: request.data, model: this.model, interpretedAt: new Date().toISOString() };
  }
}
