import { mkdir, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import type { StoredRequest } from "./types.js";

const rendererSource = fileURLToPath(new URL("../../../packages/ticket-renderer/src", import.meta.url));

export async function renderRequest(record: StoredRequest, artifactRoot: string) {
  const output = resolve(artifactRoot, record.requestId);
  await mkdir(output, { recursive: true });
  const input = join(output, "render-input.json");
  await writeFile(input, JSON.stringify({ request: record.input, shortUrl: record.shortUrl }), "utf8");

  const executable = process.env.PRINTDESK_PYTHON ?? "python";
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(
      executable,
      ["-m", "printdesk_renderer.renderer", "--input", input, "--output", output],
      {
        env: {
          ...process.env,
          PYTHONPATH: [rendererSource, process.env.PYTHONPATH].filter(Boolean).join(process.platform === "win32" ? ";" : ":"),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`renderer_failed (${code}): ${stderr.trim()}`));
    });
  });
  return { previewPath: join(output, "preview.png"), escposPath: join(output, "ticket.escpos") };
}
