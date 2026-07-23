import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

interface ConfigFile {
  projectId?: string;
  subscriptionId?: string;
  printerCheckSubscriptionId?: string;
  apiBaseUrl?: string;
  audience?: string;
  printerId?: string;
  printerHost?: string;
  printerPort?: number;
  spoolDirectory?: string;
  credentialsPath?: string;
  logPath?: string;
}

export interface AgentConfig {
  projectId: string;
  subscriptionId: string;
  printerCheckSubscriptionId: string;
  apiBaseUrl: string;
  audience: string;
  printerId: string;
  printerHost: string;
  printerPort: number;
  spoolDirectory: string;
  credentialsPath: string;
  logPath: string;
  configPath: string;
}

function optionalString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function required(value: string | undefined, name: string) {
  if (!value) throw new Error(`missing_agent_configuration:${name}`);
  return value;
}

function defaultRoot() {
  const programData = optionalString(process.env.PROGRAMDATA);
  return programData ? join(programData, "PrintDesk") : join(process.cwd(), ".local-data", "agent");
}

export function loadAgentConfig(): AgentConfig {
  const root = defaultRoot();
  const configPath = optionalString(process.env.PRINTDESK_CONFIG) ?? join(root, "config.json");
  let file: ConfigFile = {};
  if (existsSync(configPath)) {
    const parsed: unknown = JSON.parse(readFileSync(configPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid_agent_configuration");
    file = parsed as ConfigFile;
  }
  const apiBaseUrl = required(
    optionalString(process.env.PRINTDESK_API_BASE_URL) ?? optionalString(file.apiBaseUrl),
    "apiBaseUrl",
  ).replace(/\/$/, "");
  const rawPort = process.env.PRINTDESK_PRINTER_PORT
    ? Number.parseInt(process.env.PRINTDESK_PRINTER_PORT, 10)
    : file.printerPort ?? 9100;
  if (!Number.isInteger(rawPort) || rawPort < 1 || rawPort > 65_535) throw new Error("invalid_printer_port");

  return {
    projectId: required(optionalString(process.env.GOOGLE_CLOUD_PROJECT) ?? optionalString(file.projectId), "projectId"),
    subscriptionId: required(
      optionalString(process.env.PRINTDESK_AGENT_SUBSCRIPTION) ?? optionalString(file.subscriptionId),
      "subscriptionId",
    ),
    printerCheckSubscriptionId: optionalString(process.env.PRINTDESK_PRINTER_CHECK_SUBSCRIPTION)
      ?? optionalString(file.printerCheckSubscriptionId)
      ?? "home-printer-checks",
    apiBaseUrl,
    audience: optionalString(process.env.PRINTDESK_DEVICE_TOKEN_AUDIENCE)
      ?? optionalString(file.audience)
      ?? apiBaseUrl,
    printerId: optionalString(process.env.PRINTDESK_PRINTER_ID) ?? optionalString(file.printerId) ?? "home",
    printerHost: required(
      optionalString(process.env.PRINTDESK_PRINTER_HOST) ?? optionalString(file.printerHost),
      "printerHost",
    ),
    printerPort: rawPort,
    spoolDirectory: optionalString(process.env.PRINTDESK_SPOOL_DIRECTORY)
      ?? optionalString(file.spoolDirectory)
      ?? join(root, "spool"),
    credentialsPath: optionalString(process.env.GOOGLE_APPLICATION_CREDENTIALS)
      ?? optionalString(file.credentialsPath)
      ?? join(root, "credentials.json"),
    logPath: optionalString(process.env.PRINTDESK_LOG_PATH)
      ?? optionalString(file.logPath)
      ?? join(root, "logs", "agent.log"),
    configPath,
  };
}

function printable(value: unknown) {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function installFileLogger(logPath: string) {
  mkdirSync(dirname(logPath), { recursive: true });
  if (existsSync(logPath) && statSync(logPath).size > 5 * 1024 * 1024) {
    const previous = `${logPath}.1`;
    if (existsSync(previous)) {
      try {
        renameSync(previous, `${previous}.${Date.now()}`);
      } catch {
        // Logging must never prevent printing.
      }
    }
    try {
      renameSync(logPath, previous);
    } catch {
      // Keep appending if another process still owns the file.
    }
  }
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  const write = (level: "INFO" | "ERROR", args: unknown[]) => {
    const line = `${new Date().toISOString()} ${level} ${args.map(printable).join(" ")}\n`;
    try {
      appendFileSync(logPath, line, "utf8");
    } catch {
      // Console output remains available when the log cannot be written.
    }
  };
  console.log = (...args: unknown[]) => {
    write("INFO", args);
    originalLog(...args);
  };
  console.error = (...args: unknown[]) => {
    write("ERROR", args);
    originalError(...args);
  };
}
