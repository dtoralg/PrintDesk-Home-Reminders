import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredRequest } from "./domain.js";
import {
  HttpNotionPageWriter,
  isAllowedNotionUrl,
  parseNotionResponsibleUserMap,
} from "./notion-adapter.js";

const dataSourceId = "11e8fbfd-5551-817d-b66f-000b6db26176";
const projectPageId = "3aa8fbfd-5551-8055-9787-e5ae9dc76364";
const responsibleUserId = "fffd872b-594c-814b-882e-000283c18ed9";
const secondResponsibleUserId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const request = {
  requestId: "11111111-1111-4111-8111-111111111111",
  input: {
    type: "task",
    title: "Revisión del pingüino",
    body: "Póliza, conexión y autorización. ¿Está todo bien? ¡Sí!",
    important: true,
    dueAt: "2026-07-25T10:00:00.000Z",
  },
  createdBy: { uid: "user-1", displayName: "Dani", email: "dani@example.com" },
  source: "pwa",
  shortCode: "abc12345",
  shortUrl: "https://printdesk.example/r/abc12345",
  createdAt: "2026-07-23T18:00:00.000Z",
} satisfies StoredRequest;

const dataSource = {
  object: "data_source",
  id: dataSourceId,
  properties: {
    Name: { id: "title", type: "title", title: {} },
    "Due Date ": { id: "date", type: "date", date: {} },
    Status: { id: "status", type: "status", status: {} },
    "Priority ": { id: "priority", type: "select", select: {} },
    "Complete ": { id: "complete", type: "formula", formula: {} },
    "Project ": { id: "project", type: "relation", relation: {} },
    Responsable: { id: "responsible", type: "people", people: {} },
  },
};

function writer(overrides: Partial<ConstructorParameters<typeof HttpNotionPageWriter>[0]> = {}) {
  return new HttpNotionPageWriter({
    token: "secret-token",
    dataSourceId,
    projectPageId,
    defaultResponsibleUserId: responsibleUserId,
    apiBaseUrl: "https://api.notion.test/v1",
    ...overrides,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("HttpNotionPageWriter", () => {
  it("crea una tarea en la fuente de datos respetando su esquema real", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(dataSource), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        url: "https://www.notion.so/Revisi-n-bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(writer({
      responsibleUserMap: { "user-1": secondResponsibleUserId },
    }).createPage(request)).resolves.toMatchObject({
      pageId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      pageUrl: expect.stringContaining("https://www.notion.so/"),
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      `https://api.notion.test/v1/data_sources/${dataSourceId}`,
      expect.objectContaining({ headers: expect.any(Object) }),
    );
    const [endpoint, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(endpoint).toBe("https://api.notion.test/v1/pages");
    expect((options.headers as Record<string, string>)["notion-version"]).toBe("2026-03-11");
    const payload = JSON.parse(String(options.body)) as {
      parent: { type: string; data_source_id: string };
      properties: Record<string, unknown>;
      children: unknown[];
    };
    expect(payload.parent).toEqual({ type: "data_source_id", data_source_id: dataSourceId });
    expect(payload.properties).toMatchObject({
      Name: { title: [{ text: { content: "Revisión del pingüino" } }] },
      "Due Date ": { date: { start: "2026-07-25" } },
      Status: { status: { name: "To-Do" } },
      "Priority ": { select: { name: "Medium Priority" } },
      "Project ": { relation: [{ id: projectPageId }] },
      Responsable: { people: [{ object: "user", id: secondResponsibleUserId }] },
    });
    expect(payload.properties).not.toHaveProperty("Complete ");
    expect(JSON.stringify(payload.children)).toContain("¿Está todo bien? ¡Sí!");
  });

  it("omite Due Date cuando el usuario no selecciona fecha y escribe Complete si fuera numérico", async () => {
    const numberDataSource = {
      ...dataSource,
      properties: {
        ...dataSource.properties,
        "Complete ": { id: "complete", type: "number", number: {} },
      },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(numberDataSource), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        url: "https://www.notion.so/Tarea-cccccccccccc4ccc8ccccccccccccccc",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await writer().createPage({
      ...request,
      input: { ...request.input, dueAt: null },
    });

    const [, options] = fetchMock.mock.calls[1] as [string, RequestInit];
    const payload = JSON.parse(String(options.body)) as { properties: Record<string, unknown> };
    expect(payload.properties).not.toHaveProperty("Due Date ");
    expect(payload.properties["Complete "]).toEqual({ number: 0 });
  });

  it("rechaza destinos que no pertenezcan a Notion", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(dataSource), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        url: "https://attacker.example/ticket",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(writer().createPage(request)).rejects.toThrow("notion_invalid_page_response");
    expect(isAllowedNotionUrl("https://www.notion.so/page")).toBe(true);
    expect(isAllowedNotionUrl("https://app.notion.com/page")).toBe(true);
    expect(isAllowedNotionUrl("http://www.notion.so/page")).toBe(false);
    expect(isAllowedNotionUrl("https://notion.so.attacker.example/page")).toBe(false);
  });

  it("valida y normaliza el mapa de responsables", () => {
    expect(parseNotionResponsibleUserMap(JSON.stringify({
      "DANI@EXAMPLE.COM": secondResponsibleUserId,
    }))).toEqual({ "dani@example.com": secondResponsibleUserId });
    expect(() => parseNotionResponsibleUserMap("{nope")).toThrow(
      "invalid_environment_variable:PRINTDESK_NOTION_RESPONSIBLE_USER_MAP",
    );
  });
});
