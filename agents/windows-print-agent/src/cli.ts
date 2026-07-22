import { runDryJob } from "./index.js";

const [apiBaseUrl, jobId, spoolDirectory = ".local-data/spool"] = process.argv.slice(2);
if (!apiBaseUrl || !jobId) {
  console.error("Uso: pnpm --filter @printdesk/windows-print-agent dev -- <api-url> <job-id> [spool]");
  process.exit(2);
}

console.log(await runDryJob(apiBaseUrl, jobId, spoolDirectory));
