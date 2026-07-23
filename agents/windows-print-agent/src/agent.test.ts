import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectEscPos } from "./escpos.js";
import { runPrinterCheck, runPrintJob } from "./index.js";
import { Tcp9100Printer, PrinterDeliveryError } from "./tcp-printer.js";
import { startVirtualPrinter, type VirtualPrinter } from "./virtual-printer.js";

const directories: string[] = [];
const printers: VirtualPrinter[] = [];
const tcpServers: Server[] = [];

function ticket(widthBytes = 72, height = 8) {
  return Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height, 0x00]),
    Buffer.alloc(widthBytes * height, 0xaa),
    Buffer.from([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]),
  ]);
}

afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(printers.splice(0).map((printer) => printer.close()));
  await Promise.all(tcpServers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("ESC/POS dry printing", () => {
  it("validates the 576px raster and cut command", () => {
    expect(inspectEscPos(ticket())).toEqual({
      widthPixels: 576,
      heightPixels: 8,
      rasterBytes: 576,
      hasCut: true,
    });
    expect(() => inspectEscPos(Buffer.from("not a ticket"))).toThrow("escpos_too_short");
  });

  it("sends the exact bytes over TCP 9100 to the virtual printer", async () => {
    const directory = await mkdtemp(join(tmpdir(), "printdesk-virtual-printer-"));
    directories.push(directory);
    const virtual = await startVirtualPrinter(directory);
    printers.push(virtual);
    const bytes = ticket();

    await new Tcp9100Printer({ host: virtual.host, port: virtual.port }).send(bytes);
    const capture = await virtual.waitForCapture();

    expect(capture.widthPixels).toBe(576);
    expect(capture.bytes).toEqual(bytes);
    expect(await readFile(capture.path)).toEqual(bytes);
  });

  it("classifies connection failures as safe to retry", async () => {
    const printer = new Tcp9100Printer({
      host: "127.0.0.1",
      port: 1,
      connectAttempts: 2,
      connectTimeoutMs: 50,
    });
    const error = await printer.send(ticket()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PrinterDeliveryError);
    expect((error as PrinterDeliveryError).deliveryUnknown).toBe(false);
  });

  it("checks TCP availability without sending print data", async () => {
    const server = createServer((socket) => socket.end());
    tcpServers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing_tcp_test_address");

    await expect(new Tcp9100Printer({ host: "127.0.0.1", port: address.port }).probe()).resolves.toBeUndefined();
  });

  it("reports a TCP check to the API without sending printer bytes", async () => {
    let receivedBytes = 0;
    const server = createServer((socket) => socket.on("data", (chunk) => {
      receivedBytes += chunk.length;
    }));
    tcpServers.push(server);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("missing_tcp_test_address");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "checking" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        checkId: "55555555-5555-4555-8555-555555555555",
        printerId: "home",
        status: "available",
        error: null,
        requestedAt: "2026-07-23T18:00:00.000Z",
        updatedAt: "2026-07-23T18:00:01.000Z",
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runPrinterCheck(
      "https://api.example.test",
      "55555555-5555-4555-8555-555555555555",
      { host: "127.0.0.1", port: address.port },
      { authorization: async () => "Bearer device-token" },
    )).resolves.toMatchObject({ status: "available" });

    expect(receivedBytes).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const completion = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(String(completion[0])).toContain("/v1/printer-checks/55555555-5555-4555-8555-555555555555/complete");
    expect(JSON.parse(String(completion[1].body))).toEqual({ available: true, error: null });
  });

  it("treats an already completed printer check as a harmless redelivery", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "check_not_pending" }),
      { status: 409, headers: { "content-type": "application/json" } },
    ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runPrinterCheck(
      "https://api.example.test",
      "55555555-5555-4555-8555-555555555555",
      { host: "127.0.0.1", port: 9100 },
      { authorization: async () => "Bearer device-token" },
    )).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports checking and printing states around the real transport", async () => {
    const bytes = ticket();
    const probe = vi.fn().mockResolvedValue(undefined);
    const send = vi.fn().mockResolvedValue(undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ artifactUrl: "/artifact" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(bytes, { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "checking_printer" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "printing" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: "printed" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(runPrintJob("https://api.example.test", crypto.randomUUID(), {
      simulated: false,
      transport: { probe, send },
      authorization: async () => "Bearer device-token",
    })).resolves.toMatchObject({ bytesWritten: bytes.length, job: { status: "printed" } });

    expect(probe).toHaveBeenCalledOnce();
    expect(Buffer.from(send.mock.calls[0]![0] as Uint8Array)).toEqual(bytes);
    expect(JSON.parse(String((fetchMock.mock.calls[2] as [URL, RequestInit])[1].body))).toEqual({
      status: "checking_printer",
    });
    expect(JSON.parse(String((fetchMock.mock.calls[3] as [URL, RequestInit])[1].body))).toEqual({
      status: "printing",
    });
  });
});
