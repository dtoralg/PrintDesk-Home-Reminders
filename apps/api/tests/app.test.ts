import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "printdesk-api-"));
  process.env.PRINTDESK_ALLOW_DEV_AUTH = "true";
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("API contract", () => {
  it("rejects identity and status fields supplied by a client", async () => {
    const app = await buildApp({ dataDir: directory });
    const response = await app.inject({
      method: "POST",
      url: "/v1/requests",
      payload: {
        request: { type: "task", title: "No válida", createdBy: { uid: "spoofed" } },
        printerId: "home",
        source: "pwa",
      },
    });
    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("fails closed when development authentication is disabled", async () => {
    delete process.env.PRINTDESK_ALLOW_DEV_AUTH;
    const app = await buildApp({ dataDir: directory });
    const response = await app.inject({
      method: "POST",
      url: "/v1/requests",
      payload: { request: { type: "task", title: "Privada" }, printerId: "home", source: "pwa" },
    });
    expect(response.statusCode).toBe(401);
    await app.close();
  });
});
