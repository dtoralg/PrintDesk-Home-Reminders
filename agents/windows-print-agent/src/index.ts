import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

async function expectOk(response: Response, operation: string) {
  if (!response.ok) throw new Error(`${operation}_failed (${response.status}): ${await response.text()}`);
  return response;
}

export async function runDryJob(apiBaseUrl: string, jobId: string, spoolDirectory: string) {
  const base = apiBaseUrl.endsWith("/") ? apiBaseUrl : `${apiBaseUrl}/`;
  const claim = await expectOk(
    await fetch(new URL(`v1/print-jobs/${jobId}/claim`, base), { method: "POST" }),
    "claim",
  );
  const { artifactUrl } = (await claim.json()) as { artifactUrl: string };
  const artifact = await expectOk(await fetch(new URL(artifactUrl.replace(/^\//, ""), base)), "download");
  const bytes = new Uint8Array(await artifact.arrayBuffer());
  if (bytes.length === 0) throw new Error("empty_escpos_artifact");

  const directory = resolve(spoolDirectory);
  await mkdir(directory, { recursive: true });
  const spoolPath = join(directory, `${jobId}.escpos`);
  await writeFile(spoolPath, bytes);

  const completed = await expectOk(
    await fetch(new URL(`v1/print-jobs/${jobId}/complete`, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ outcome: "printed_simulated" }),
    }),
    "complete",
  );
  return { spoolPath, bytesWritten: bytes.length, job: await completed.json() };
}
