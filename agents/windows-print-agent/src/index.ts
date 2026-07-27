import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { inspectEscPos } from "./escpos.js";
import { PrinterDeliveryError, Tcp9100Printer, type PrintTransport, type TcpPrinterOptions } from "./tcp-printer.js";
import type { PrinterCheckView } from "@printdesk/shared-models";

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
  authorization?: () => Promise<string>;
}

async function authHeaders(options: RunPrintJobOptions) {
  return options.authorization ? { authorization: await options.authorization() } : {};
}

async function reportFailure(
  base: string,
  jobId: string,
  error: unknown,
  deliveryAttempted: boolean,
  options: RunPrintJobOptions,
) {
  const retryable = error instanceof PrinterDeliveryError
    ? !error.deliveryUnknown
    : !deliveryAttempted;
  const message = error instanceof Error ? error.message : "printer_failed";
  await fetch(new URL(`v1/print-jobs/${jobId}/fail`, base), {
    method: "POST",
    headers: { "content-type": "application/json", ...await authHeaders(options) },
    body: JSON.stringify({ error: message, retryable }),
  }).catch(() => undefined);
}

async function reportStatus(
  base: string,
  jobId: string,
  status: "checking_printer" | "printing",
  options: RunPrintJobOptions,
) {
  return expectOk(
    await fetch(new URL(`v1/print-jobs/${jobId}/status`, base), {
      method: "POST",
      headers: { "content-type": "application/json", ...await authHeaders(options) },
      body: JSON.stringify({ status }),
    }),
    `status_${status}`,
  );
}

async function completeJob(
  base: string,
  jobId: string,
  outcome: "printed" | "printed_simulated",
  options: RunPrintJobOptions,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      return await expectOk(
        await fetch(new URL(`v1/print-jobs/${jobId}/complete`, base), {
          method: "POST",
          headers: { "content-type": "application/json", ...await authHeaders(options) },
          body: JSON.stringify({ outcome }),
        }),
        "complete",
      );
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise((resolveDelay) => setTimeout(resolveDelay, 300 * (attempt + 1)));
    }
  }
  throw lastError;
}

export async function runPrintJob(apiBaseUrl: string, jobId: string, options: RunPrintJobOptions) {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const claim = await expectOk(
    await fetch(new URL(`v1/print-jobs/${jobId}/claim`, base), {
      method: "POST",
      headers: await authHeaders(options),
    }),
    "claim",
  );
  const { artifactUrl } = (await claim.json()) as { artifactUrl: string };
  let deliveryAttempted = false;
  let deliverySucceeded = false;
  try {
    const artifact = await expectOk(await fetch(new URL(artifactUrl.replace(/^\//, ""), base), {
      headers: await authHeaders(options),
    }), "download");
    const bytes = new Uint8Array(await artifact.arrayBuffer());
    const inspection = inspectEscPos(bytes);
    let spoolPath: string | null = null;
    if (options.spoolDirectory) {
      const directory = resolve(options.spoolDirectory);
      await mkdir(directory, { recursive: true });
      spoolPath = join(directory, `${jobId}.escpos`);
      await writeFile(spoolPath, bytes);
    }
    await reportStatus(base, jobId, "checking_printer", options);
    if (options.transport?.probe) await options.transport.probe();
    await reportStatus(base, jobId, "printing", options);
    if (options.transport) {
      deliveryAttempted = true;
      await options.transport.send(bytes);
    }
    deliverySucceeded = true;
    const completed = await completeJob(
      base,
      jobId,
      options.simulated ? "printed_simulated" : "printed",
      options,
    );
    return { spoolPath, bytesWritten: bytes.length, inspection, job: await completed.json() };
  } catch (error) {
    if (!deliverySucceeded) await reportFailure(base, jobId, error, deliveryAttempted, options);
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
  options: { spoolDirectory?: string; simulated?: boolean; authorization?: () => Promise<string> } = {},
) {
  return runPrintJob(apiBaseUrl, jobId, {
    ...(options.spoolDirectory ? { spoolDirectory: options.spoolDirectory } : {}),
    ...(options.authorization ? { authorization: options.authorization } : {}),
    simulated: options.simulated ?? false,
    transport: new Tcp9100Printer(printer),
  });
}

export async function runPrinterCheck(
  apiBaseUrl: string,
  checkId: string,
  printer: TcpPrinterOptions,
  options: { authorization?: () => Promise<string> } = {},
) {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const headers = async () => options.authorization ? { authorization: await options.authorization() } : {};
  const claim = await fetch(new URL(`v1/printer-checks/${checkId}/claim`, base), {
    method: "POST",
    headers: await headers(),
  });
  if (claim.status === 409) return null;
  await expectOk(claim, "printer_check_claim");

  let available = false;
  let error: string | null = null;
  try {
    await new Tcp9100Printer(printer).probe();
    available = true;
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "printer_unreachable";
  }

  const completed = await expectOk(
    await fetch(new URL(`v1/printer-checks/${checkId}/complete`, base), {
      method: "POST",
      headers: { "content-type": "application/json", ...await headers() },
      body: JSON.stringify({ available, error }),
    }),
    "printer_check_complete",
  );
  return await completed.json() as PrinterCheckView;
}
