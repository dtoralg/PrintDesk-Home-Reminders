import { createServer, type Server } from "node:net";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectEscPos, type EscPosInspection } from "./escpos.js";

export interface CapturedTicket extends EscPosInspection {
  path: string;
  bytes: Buffer;
}

export interface VirtualPrinter {
  host: string;
  port: number;
  captures: CapturedTicket[];
  waitForCapture(timeoutMs?: number): Promise<CapturedTicket>;
  close(): Promise<void>;
}

export async function startVirtualPrinter(spoolDirectory: string, port = 0): Promise<VirtualPrinter> {
  const host = "127.0.0.1";
  const directory = resolve(spoolDirectory);
  await mkdir(directory, { recursive: true });
  const captures: CapturedTicket[] = [];
  const pending: CapturedTicket[] = [];
  const waiters: Array<(capture: CapturedTicket) => void> = [];
  let sequence = 0;

  const server: Server = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", async () => {
      try {
        const bytes = Buffer.concat(chunks);
        const inspection = inspectEscPos(bytes);
        sequence += 1;
        const path = join(directory, `ticket-${String(sequence).padStart(4, "0")}.escpos`);
        await writeFile(path, bytes);
        const capture = { ...inspection, path, bytes };
        captures.push(capture);
        const waiter = waiters.shift();
        if (waiter) waiter(capture);
        else pending.push(capture);
      } finally {
        socket.end();
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("virtual_printer_address_unavailable");

  return {
    host,
    port: address.port,
    captures,
    waitForCapture(timeoutMs = 5_000) {
      const existing = pending.shift();
      if (existing) return Promise.resolve(existing);
      return new Promise((resolveCapture, reject) => {
        const timer = setTimeout(() => reject(new Error("virtual_printer_capture_timeout")), timeoutMs);
        waiters.push((capture) => {
          clearTimeout(timer);
          resolveCapture(capture);
        });
      });
    },
    close: () => new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}
