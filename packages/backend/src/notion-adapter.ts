import type { StoredRequest } from "./domain.js";
import type { NotionPageWriter } from "./ports.js";

const NOTION_HOSTS = new Set(["notion.so", "www.notion.so"]);
const TYPE_LABELS = {
  task: "Tarea",
  idea: "Idea",
  reminder: "Recordatorio",
  note: "Nota",
} as const;
const TYPE_ICONS = {
  task: "✅",
  idea: "💡",
  reminder: "⏰",
  note: "📝",
} as const;

export function isAllowedNotionUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && NOTION_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function richText(content: string) {
  return [{ type: "text", text: { content } }];
}

function paragraph(content: string) {
  return { object: "block", type: "paragraph", paragraph: { rich_text: richText(content) } };
}

function splitText(value: string, limit = 1_900) {
  const chunks: string[] = [];
  let remaining = value.trim();
  while (remaining.length > limit) {
    const candidate = remaining.slice(0, limit);
    const breakAt = Math.max(candidate.lastIndexOf("\n"), candidate.lastIndexOf(" "));
    const end = breakAt > limit / 2 ? breakAt : limit;
    chunks.push(remaining.slice(0, end).trim());
    remaining = remaining.slice(end).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

export class HttpNotionPageWriter implements NotionPageWriter {
  constructor(
    private readonly token: string,
    private readonly parentPageId: string,
    private readonly apiVersion = "2026-03-11",
    private readonly endpoint = "https://api.notion.com/v1/pages",
  ) {}

  async createPage(request: StoredRequest) {
    const due = request.input.dueAt
      ? new Intl.DateTimeFormat("es-ES", {
        dateStyle: "long",
        timeZone: "Europe/Madrid",
      }).format(new Date(request.input.dueAt))
      : null;
    const children = [
      ...splitText(request.input.body || "Sin detalles adicionales.").map(paragraph),
      { object: "block", type: "divider", divider: {} },
      paragraph(`${TYPE_ICONS[request.input.type]} Tipo: ${TYPE_LABELS[request.input.type]}`),
      ...(request.input.important ? [paragraph("⭐ Importante")] : []),
      ...(due ? [paragraph(`📅 Fecha: ${due}`)] : []),
      paragraph(`👤 ${request.createdBy.displayName || request.createdBy.email}`),
      paragraph(`🔗 ${request.shortUrl}`),
    ];
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        "notion-version": this.apiVersion,
      },
      body: JSON.stringify({
        parent: { page_id: this.parentPageId },
        icon: { type: "emoji", emoji: TYPE_ICONS[request.input.type] },
        properties: {
          title: {
            title: [{ type: "text", text: { content: request.input.title } }],
          },
        },
        children,
      }),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000);
      throw new Error(`notion_create_page_failed (${response.status}): ${detail}`);
    }
    const page = await response.json() as { id?: unknown; url?: unknown };
    if (typeof page.id !== "string" || typeof page.url !== "string" || !isAllowedNotionUrl(page.url)) {
      throw new Error("notion_invalid_page_response");
    }
    return { pageId: page.id, pageUrl: page.url };
  }
}
