import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectEscPos } from "./escpos.js";
import { PrinterDeliveryError, Tcp9100Printer, type PrintTransport, type TcpPrinterOptions } from "./tcp-printer.js";

export { inspectEscPos } from "./escpos.js";
export { PrinterDeliveryError, Tcp9100Printer } from "./tcp-printer.js";
export { startVirtualPrinter } from "./virtual-printer.js";

async function expectOk(response: Response, operation: string) {
  if (!response.ok) throw new Error(`${operation}_failed (${response.status}): ${await response.text()}`);
  return response;
}

export interface RunPrintJobOptions {
  spoolDirectory?: string;
  transport?: PrintTransport;
  simulated: boolean;
}

async function reportFailure(base: string, jobId: string, error: unknown, deliveryAttempted: boolean) {
  const retryable = error instanceof PrinterDeliveryError
    ? !error.deliveryUnknown
    : !deliveryAttempted;
  const message = error instanceof Error ? error.message : "printer_failed";
  await fetch(new URL(`v1/print-jobs/${jobId}/fail`, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ error: message, retryable }),
  }).catch(() => undefined);
}

export async function runPrintJob(apiBaseUrl: string, jobId: string, options: RunPrintJobOptions) {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const claim = await expectOk(
    await fetch(new URL(`v1/print-jobs/${jobId}/claim`, base), { method: "POST" }),
    "claim",
  );
  const { artifactUrl } = (await claim.json()) as { artifactUrl: string };
  let deliveryAttempted = false;
  try {
    const artifact = await expectOk(await fetch(new URL(artifactUrl.replace(/^\//, ""), base)), "download");
    const bytes = new Uint8Array(await artifact.arrayBuffer());
    const inspection = inspectEscPos(bytes);
    let spoolPath: string | null = null;
    if (options.spoolDirectory) {
      const directory = resolve(options.spoolDirectory);
      await mkdir(directory, { recursive: true });
      spoolPath = join(directory, `${jobId}.escpos`);
      await writeFile(spoolPath, bytes);
    }
    if (options.transport) {
      deliveryAttempted = true;
      await options.transport.send(bytes);
    }
    const completed = await expectOk(
      await fetch(new URL(`v1/print-jobs/${jobId}/complete`, base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ outcome: options.simulated ? "printed_simulated" : "printed" }),
      }),
      "complete",
    );
    return { spoolPath, bytesWritten: bytes.length, inspection, job: await completed.json() };
  } catch (error) {
    await reportFailure(base, jobId, error, deliveryAttempted);
    throw error;
  }
}

export function runDryJob(apiBaseUrl: string, jobId: string, spoolDirectory: string) {
  return runPrintJob(apiBaseUrl, jobId, { spoolDirectory, simulated: true });
}

export function runTcpJob(
  apiBaseUrl: string,
  jobId: string,
  printer: TcpPrinterOptions,
  options: { spoolDirectory?: string; simulated?: boolean } = {},
) {
  return runPrintJob(apiBaseUrl, jobId, {
    ...(options.spoolDirectory ? { spoolDirectory: options.spoolDirectory } : {}),
    simulated: options.simulated ?? false,
    transport: new Tcp9100Printer(printer),
  });
}
