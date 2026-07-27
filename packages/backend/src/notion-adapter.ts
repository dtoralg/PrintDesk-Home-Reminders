import type { StoredRequest } from "./domain.js";
import type { NotionPageWriter } from "./ports.js";

const NOTION_HOSTS = new Set(["notion.so", "www.notion.so", "app.notion.com"]);
const NOTION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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

interface NotionPropertySchema {
  type?: unknown;
}

interface NotionDataSource {
  properties?: Record<string, NotionPropertySchema>;
}

interface ResolvedTaskSchema {
  name: string;
  dueDate: string;
  status: string;
  priority: string;
  complete: { name: string; type: "formula" | "number" };
  project: string;
  responsible: string;
}

export interface HttpNotionPageWriterOptions {
  token: string;
  dataSourceId: string;
  projectPageId: string;
  defaultResponsibleUserId: string;
  responsibleUserMap?: Record<string, string>;
  apiVersion?: string;
  apiBaseUrl?: string;
}

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

function requireNotionId(name: string, value: string) {
  if (!NOTION_ID.test(value)) throw new Error(`invalid_environment_variable:${name}`);
  return value;
}

function normalizePropertyName(value: string) {
  return value.trim().toLowerCase();
}

function normalizeIdentityKey(value: string) {
  const trimmed = value.trim();
  return trimmed.includes("@") ? trimmed.toLowerCase() : trimmed;
}

export function parseNotionResponsibleUserMap(raw: string | undefined) {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("invalid_environment_variable:PRINTDESK_NOTION_RESPONSIBLE_USER_MAP");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("invalid_environment_variable:PRINTDESK_NOTION_RESPONSIBLE_USER_MAP");
  }
  return Object.fromEntries(Object.entries(parsed).map(([identity, notionUserId]) => {
    if (typeof notionUserId !== "string") {
      throw new Error("invalid_environment_variable:PRINTDESK_NOTION_RESPONSIBLE_USER_MAP");
    }
    return [normalizeIdentityKey(identity), requireNotionId("PRINTDESK_NOTION_RESPONSIBLE_USER_MAP", notionUserId)];
  }));
}

function resolveProperty(
  properties: Record<string, NotionPropertySchema>,
  expectedName: string,
  allowedTypes: string[],
) {
  const entry = Object.entries(properties)
    .find(([name]) => normalizePropertyName(name) === normalizePropertyName(expectedName));
  if (!entry) throw new Error(`notion_schema_property_missing:${expectedName}`);
  const [name, property] = entry;
  if (typeof property.type !== "string" || !allowedTypes.includes(property.type)) {
    throw new Error(`notion_schema_property_type_mismatch:${expectedName}`);
  }
  return { name, type: property.type };
}

function madridDate(isoDateTime: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "Europe/Madrid",
  }).formatToParts(new Date(isoDateTime));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export class HttpNotionPageWriter implements NotionPageWriter {
  private readonly token: string;
  private readonly dataSourceId: string;
  private readonly projectPageId: string;
  private readonly defaultResponsibleUserId: string;
  private readonly responsibleUserMap: Record<string, string>;
  private readonly apiVersion: string;
  private readonly apiBaseUrl: string;
  private schemaPromise: Promise<ResolvedTaskSchema> | null = null;

  constructor(options: HttpNotionPageWriterOptions) {
    this.token = options.token;
    this.dataSourceId = requireNotionId("PRINTDESK_NOTION_DATA_SOURCE_ID", options.dataSourceId);
    this.projectPageId = requireNotionId("PRINTDESK_NOTION_PROJECT_PAGE_ID", options.projectPageId);
    this.defaultResponsibleUserId = requireNotionId(
      "PRINTDESK_NOTION_DEFAULT_RESPONSIBLE_USER_ID",
      options.defaultResponsibleUserId,
    );
    this.responsibleUserMap = Object.fromEntries(
      Object.entries(options.responsibleUserMap ?? {}).map(([identity, userId]) => [
        normalizeIdentityKey(identity),
        requireNotionId("PRINTDESK_NOTION_RESPONSIBLE_USER_MAP", userId),
      ]),
    );
    this.apiVersion = options.apiVersion ?? "2026-03-11";
    this.apiBaseUrl = (options.apiBaseUrl ?? "https://api.notion.com/v1").replace(/\/+$/, "");
  }

  private headers() {
    return {
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
      "notion-version": this.apiVersion,
    };
  }

  private async taskSchema() {
    this.schemaPromise ??= this.loadTaskSchema().catch((error) => {
      this.schemaPromise = null;
      throw error;
    });
    return this.schemaPromise;
  }

  private async loadTaskSchema(): Promise<ResolvedTaskSchema> {
    const response = await fetch(`${this.apiBaseUrl}/data_sources/${this.dataSourceId}`, {
      headers: this.headers(),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 1_000);
      throw new Error(`notion_retrieve_data_source_failed (${response.status}): ${detail}`);
    }
    const source = await response.json() as NotionDataSource;
    if (!source.properties) throw new Error("notion_invalid_data_source_response");
    const complete = resolveProperty(source.properties, "Complete", ["formula", "number"]);
    return {
      name: resolveProperty(source.properties, "Name", ["title"]).name,
      dueDate: resolveProperty(source.properties, "Due Date", ["date"]).name,
      status: resolveProperty(source.properties, "Status", ["status"]).name,
      priority: resolveProperty(source.properties, "Priority", ["select"]).name,
      complete: { name: complete.name, type: complete.type as "formula" | "number" },
      project: resolveProperty(source.properties, "Project", ["relation"]).name,
      responsible: resolveProperty(source.properties, "Responsable", ["people"]).name,
    };
  }

  private responsibleUserId(request: StoredRequest) {
    return this.responsibleUserMap[normalizeIdentityKey(request.createdBy.uid)]
      ?? this.responsibleUserMap[normalizeIdentityKey(request.createdBy.email)]
      ?? this.defaultResponsibleUserId;
  }

  async createPage(request: StoredRequest) {
    const schema = await this.taskSchema();
    const dueDate = request.input.dueAt ? madridDate(request.input.dueAt) : null;
    const dueLabel = request.input.dueAt
      ? new Intl.DateTimeFormat("es-ES", {
        dateStyle: "long",
        timeZone: "Europe/Madrid",
      }).format(new Date(request.input.dueAt))
      : null;
    const properties: Record<string, unknown> = {
      [schema.name]: { title: richText(request.input.title) },
      [schema.status]: { status: { name: "To-Do" } },
      [schema.priority]: { select: { name: "Medium Priority" } },
      [schema.project]: { relation: [{ id: this.projectPageId }] },
      [schema.responsible]: {
        people: [{ object: "user", id: this.responsibleUserId(request) }],
      },
    };
    if (dueDate) properties[schema.dueDate] = { date: { start: dueDate } };
    if (schema.complete.type === "number") properties[schema.complete.name] = { number: 0 };

    const children = [
      ...splitText(request.input.body || "Sin detalles adicionales.").map(paragraph),
      { object: "block", type: "divider", divider: {} },
      paragraph(`${TYPE_ICONS[request.input.type]} Tipo: ${TYPE_LABELS[request.input.type]}`),
      ...(request.input.important ? [paragraph("⭐ Importante")] : []),
      ...(dueLabel ? [paragraph(`📅 Fecha: ${dueLabel}`)] : []),
      paragraph(`👤 ${request.createdBy.displayName || request.createdBy.email}`),
      paragraph(`🔗 ${request.shortUrl}`),
    ];
    const response = await fetch(`${this.apiBaseUrl}/pages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        parent: { type: "data_source_id", data_source_id: this.dataSourceId },
        icon: { type: "emoji", emoji: TYPE_ICONS[request.input.type] },
        properties,
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
