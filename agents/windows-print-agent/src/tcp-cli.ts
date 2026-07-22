import { runTcpJob } from "./index.js";

const [apiBaseUrl, jobId, host, rawPort = "9100", spoolDirectory, rawMode] = process.argv.slice(2);
if (!apiBaseUrl || !jobId || !host) {
  console.error("Uso: pnpm --filter @printdesk/windows-print-agent print:tcp -- <api-url> <job-id> <host> [puerto] [spool] [--simulated]");
  process.exit(2);
}
const port = Number.parseInt(rawPort, 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid_printer_port");

console.log(await runTcpJob(apiBaseUrl, jobId, { host, port }, {
  ...(spoolDirectory ? { spoolDirectory } : {}),
  simulated: rawMode === "--simulated",
}));
