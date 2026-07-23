import { afterEach, describe, expect, it, vi } from "vitest";
import type { StoredRequest } from "./domain.js";
import { HttpNotionPageWriter, isAllowedNotionUrl } from "./notion-adapter.js";

const request = {
  requestId: "11111111-1111-4111-8111-111111111111",
  input: {
    type: "task",
    title: "Revisión del pingüino",
    body: "Póliza, conexión y autorización. ¿Está todo bien? ¡Sí!",
    important: true,
    dueAt: null,
  },
  createdBy: { uid: "user-1", displayName: "Dani", email: "dani@example.com" },
  source: "pwa",
  shortCode: "abc12345",
  shortUrl: "https://printdesk.example/r/abc12345",
  createdAt: "2026-07-23T18:00:00.000Z",
} satisfies StoredRequest;

afterEach(() => vi.unstubAllGlobals());

describe("HttpNotionPageWriter", () => {
  it("crea una página hija con contenido Unicode y la versión vigente", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      url: "https://www.notion.so/Revisi-n-aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const writer = new HttpNotionPageWriter("secret-token", "parent-page");

    await expect(writer.createPage(request)).resolves.toMatchObject({
      pageId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      pageUrl: expect.stringContaining("https://www.notion.so/"),
    });
    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((options.headers as Record<string, string>)["notion-version"]).toBe("2026-03-11");
    const payload = JSON.parse(String(options.body)) as {
      parent: { page_id: string };
      properties: { title: { title: Array<{ text: { content: string } }> } };
      children: unknown[];
    };
    expect(payload.parent.page_id).toBe("parent-page");
    expect(payload.properties.title.title[0]?.text.content).toBe("Revisión del pingüino");
    expect(JSON.stringify(payload.children)).toContain("¿Está todo bien? ¡Sí!");
  });

  it("rechaza destinos que no pertenezcan a Notion", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      url: "https://attacker.example/ticket",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(new HttpNotionPageWriter("token", "parent").createPage(request))
      .rejects.toThrow("notion_invalid_page_response");
    expect(isAllowedNotionUrl("https://www.notion.so/page")).toBe(true);
    expect(isAllowedNotionUrl("http://www.notion.so/page")).toBe(false);
    expect(isAllowedNotionUrl("https://notion.so.attacker.example/page")).toBe(false);
  });
});
