import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectEscPos } from "./escpos.js";
import { Tcp9100Printer, PrinterDeliveryError } from "./tcp-printer.js";
import { startVirtualPrinter, type VirtualPrinter } from "./virtual-printer.js";

const directories: string[] = [];
const printers: VirtualPrinter[] = [];

function ticket(widthBytes = 72, height = 8) {
  return Buffer.concat([
    Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x01, 0x1d, 0x76, 0x30, 0x00, widthBytes, 0x00, height, 0x00]),
    Buffer.alloc(widthBytes * height, 0xaa),
    Buffer.from([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x00]),
  ]);
}

afterEach(async () => {
  await Promise.all(printers.splice(0).map((printer) => printer.close()));
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
});
