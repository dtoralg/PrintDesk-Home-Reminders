import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { StoredPrintJob, StoredRequest } from "./types.js";

export class LocalStore {
  readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private async write(kind: "requests" | "jobs", id: string, value: unknown) {
    const directory = join(this.root, kind);
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, `${id}.json`), JSON.stringify(value, null, 2), "utf8");
  }

  private async read<T>(kind: "requests" | "jobs", id: string): Promise<T | null> {
    try {
      return JSON.parse(await readFile(join(this.root, kind, `${id}.json`), "utf8")) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  putRequest(value: StoredRequest) {
    return this.write("requests", value.requestId, value);
  }

  putJob(value: StoredPrintJob) {
    return this.write("jobs", value.jobId, value);
  }

  getRequest(id: string) {
    return this.read<StoredRequest>("requests", id);
  }

  getJob(id: string) {
    return this.read<StoredPrintJob>("jobs", id);
  }
}
