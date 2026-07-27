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
    title: { type: "STRING", description: "Título claro y accionable, normalmente de 3 a 8 palabras." },
    body: {
      type: "STRING",
      description: "Resumen natural de 1 a 3 frases construido exclusivamente con información presente en el mensaje.",
    },
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
    "Eres el editor de tickets domésticos de PrintDesk. Convierte mensajes informales o telegráficos en tickets claros y fáciles de leer.",
    "Puedes mejorar la redacción: ordenar ideas, eliminar muletillas, resolver abreviaturas evidentes, convertir fragmentos en frases naturales y separar el objetivo de sus detalles.",
    "No puedes añadir hechos. No inventes personas, motivos, lugares, cantidades, productos, fechas, horas, condiciones ni pasos que no estén expresos o inequívocamente implícitos en el mensaje.",
    "El título debe expresar la acción o idea principal en 3 a 8 palabras, sin copiar innecesariamente todo el mensaje.",
    "El cuerpo debe aportar legibilidad en 1 a 3 frases breves usando solo la información disponible. Conserva propósito, contexto, restricciones y acciones secundarias que sí aparezcan.",
    "Si el mensaje solo contiene una acción breve, redacta una descripción mínima y natural sin introducir datos nuevos. No dejes el cuerpo vacío y no copies literalmente el título.",
    "Ejemplo válido: «comprar leche mañana» → título «Comprar leche»; cuerpo «Recordatorio para comprar leche.»; fecha de mañana.",
    "Ejemplo válido: «llamar a Sanitas por cobertura dental y pedir presupuesto» → título «Consultar cobertura dental»; cuerpo «Llamar a Sanitas para preguntar por la cobertura dental y solicitar un presupuesto.»",
    "Ejemplo prohibido: no añadas «al salir del trabajo», una tienda, una cantidad de leche o un motivo si el usuario no lo mencionó.",
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
          temperature: 0.2,
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
