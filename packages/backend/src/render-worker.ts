import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { RequestCreatedEvent } from "@printdesk/shared-models";
import type { ArtifactStore, EventPublisher, PrintDeskRepository } from "./ports.js";

const rendererSource = process.env.PRINTDESK_RENDERER_SOURCE
  ?? fileURLToPath(new URL("../../../packages/ticket-renderer/src", import.meta.url));

function pythonExecutable() {
  if (process.env.PRINTDESK_PYTHON) return process.env.PRINTDESK_PYTHON;
  if (process.platform === "win32") {
    const workspacePython = fileURLToPath(new URL("../../../.venv/Scripts/python.exe", import.meta.url));
    if (existsSync(workspacePython)) return workspacePython;
  }
  return "python";
}

async function render(request: { input: unknown; shortUrl: string }, directory: string) {
  const input = join(directory, "render-input.json");
  await writeFile(input, JSON.stringify({ request: request.input, shortUrl: request.shortUrl }), "utf8");
  const executable = pythonExecutable();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["-m", "printdesk_renderer.renderer", "--input", input, "--output", directory], {
      env: {
        ...process.env,
        PYTHONPATH: [rendererSource, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`renderer_failed (${code}): ${stderr.trim()}`)));
  });
  return Promise.all([readFile(join(directory, "preview.png")), readFile(join(directory, "ticket.escpos"))]);
}

export class RenderWorker {
  constructor(private readonly repository: PrintDeskRepository, private readonly artifacts: ArtifactStore) {}

  async handle(event: RequestCreatedEvent): Promise<"rendered" | "duplicate"> {
    const work = await this.repository.beginRender(event);
    if (!work) return "duplicate";
    const directory = await mkdtemp(join(tmpdir(), "printdesk-render-"));
    try {
      const [preview, escpos] = await render(work.request, directory);
      const paths = await this.artifacts.put(work.request.requestId, preview, escpos);
      await this.repository.completeRender(work.job.jobId, event.eventId, paths);
      return "rendered";
    } catch (error) {
      await this.repository.failRender(work.job.jobId, event.eventId, (error as Error).message);
      throw error;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export class InlineEventPublisher implements EventPublisher {
  constructor(private readonly worker: RenderWorker) {}
  async publish(event: RequestCreatedEvent) {
    await this.worker.handle(event);
    return event.eventId;
  }
}
