import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentConfig } from "./config.js";

const directories: string[] = [];
const originalEnvironment = { ...process.env };

afterEach(async () => {
  process.env = { ...originalEnvironment };
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Windows agent configuration", () => {
  it("loads the ProgramData JSON configuration and applies defaults", async () => {
    const programData = await mkdtemp(join(tmpdir(), "printdesk-config-"));
    directories.push(programData);
    const root = join(programData, "PrintDesk");
    await mkdir(root);
    await writeFile(join(root, "config.json"), JSON.stringify({
      projectId: "project",
      subscriptionId: "subscription",
      apiBaseUrl: "https://api.example.test/",
      printerHost: "192.168.1.153",
    }));
    process.env.PROGRAMDATA = programData;
    delete process.env.PRINTDESK_CONFIG;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.PRINTDESK_AGENT_SUBSCRIPTION;
    delete process.env.PRINTDESK_API_BASE_URL;
    delete process.env.PRINTDESK_DEVICE_TOKEN_AUDIENCE;
    delete process.env.PRINTDESK_PRINTER_ID;
    delete process.env.PRINTDESK_PRINTER_HOST;
    delete process.env.PRINTDESK_PRINTER_PORT;
    delete process.env.PRINTDESK_SPOOL_DIRECTORY;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.PRINTDESK_LOG_PATH;

    expect(loadAgentConfig()).toEqual({
      projectId: "project",
      subscriptionId: "subscription",
      apiBaseUrl: "https://api.example.test",
      audience: "https://api.example.test",
      printerId: "home",
      printerHost: "192.168.1.153",
      printerPort: 9100,
      spoolDirectory: join(root, "spool"),
      credentialsPath: join(root, "credentials.json"),
      logPath: join(root, "logs", "agent.log"),
      configPath: join(root, "config.json"),
    });
  });

  it("lets environment variables override the configuration file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "printdesk-config-"));
    directories.push(directory);
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({
      projectId: "file-project",
      subscriptionId: "file-subscription",
      apiBaseUrl: "https://file.example.test",
      printerHost: "192.168.1.10",
    }));
    process.env.PRINTDESK_CONFIG = configPath;
    process.env.GOOGLE_CLOUD_PROJECT = "environment-project";
    process.env.PRINTDESK_PRINTER_HOST = "192.168.1.153";
    process.env.PRINTDESK_PRINTER_PORT = "9200";

    const config = loadAgentConfig();

    expect(config.projectId).toBe("environment-project");
    expect(config.printerHost).toBe("192.168.1.153");
    expect(config.printerPort).toBe(9200);
  });

  it("rejects an invalid printer port", async () => {
    const directory = await mkdtemp(join(tmpdir(), "printdesk-config-"));
    directories.push(directory);
    const configPath = join(directory, "config.json");
    await writeFile(configPath, JSON.stringify({
      projectId: "project",
      subscriptionId: "subscription",
      apiBaseUrl: "https://api.example.test",
      printerHost: "192.168.1.153",
      printerPort: 70000,
    }));
    process.env.PRINTDESK_CONFIG = configPath;
    delete process.env.PRINTDESK_PRINTER_PORT;

    expect(() => loadAgentConfig()).toThrow("invalid_printer_port");
  });
});
