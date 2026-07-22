import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { runTcpJob, startVirtualPrinter } from "@printdesk/windows-print-agent";
import { buildApp } from "../src/app.js";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "printdesk-e2e-"));
  process.env.PRINTDESK_ALLOW_DEV_AUTH = "true";
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("vertical local", () => {
  it("creates, renders, downloads and dry-prints a ticket", async () => {
    const app = await buildApp({ dataDir: directory, publicBaseUrl: "http://localhost:8080" });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address() as AddressInfo;
    const apiBase = `http://127.0.0.1:${address.port}`;

    const created = await fetch(`${apiBase}/v1/requests`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "e2e-command-0001" },
      body: JSON.stringify({
        request: {
          type: "task",
          title: "Llamar a Sanitas",
          body: "Preguntar por la analítica",
          important: true,
          dueAt: "2026-07-23T10:00:00+02:00",
        },
        printerId: "home",
        source: "pwa",
      }),
    });
    expect(created.status).toBe(202);
    const result = (await created.json()) as { job: { jobId: string; status: string; previewUrl: string } };
    expect(result.job.status).toBe("queued");

    const duplicate = await fetch(`${apiBase}/v1/requests`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": "e2e-command-0001" },
      body: JSON.stringify({
        request: { type: "task", title: "No debe crear otra", body: "", important: false, dueAt: null },
        printerId: "home",
        source: "pwa",
      }),
    });
    expect(duplicate.status).toBe(200);
    expect(((await duplicate.json()) as { job: { jobId: string } }).job.jobId).toBe(result.job.jobId);

    const virtualPrinter = await startVirtualPrinter(join(directory, "virtual-printer"));
    const capturePromise = virtualPrinter.waitForCapture();
    const dryRun = await runTcpJob(
      apiBase,
      result.job.jobId,
      { host: virtualPrinter.host, port: virtualPrinter.port },
      { spoolDirectory: join(directory, "spool"), simulated: true },
    );
    const capture = await capturePromise;
    expect(dryRun.spoolPath).not.toBeNull();
    const bytes = await readFile(dryRun.spoolPath!);
    expect(bytes.length).toBeGreaterThan(1_000);
    expect(bytes.subarray(0, 2)).toEqual(Buffer.from([0x1b, 0x40]));
    expect(capture.bytes).toEqual(bytes);
    expect(capture.widthPixels).toBe(576);
    expect(capture.hasCut).toBe(true);

    const status = await fetch(`${apiBase}/v1/print-jobs/${result.job.jobId}`).then((response) => response.json()) as { status: string; attempts: number };
    expect(status).toMatchObject({ status: "printed_simulated", attempts: 1 });
    await virtualPrinter.close();
    await app.close();
  }, 20_000);
});
