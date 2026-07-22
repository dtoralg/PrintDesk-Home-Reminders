import { startVirtualPrinter } from "./virtual-printer.js";

const [rawPort = "9100", spoolDirectory = ".local-data/virtual-printer"] = process.argv.slice(2);
const port = Number.parseInt(rawPort, 10);
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("invalid_printer_port");

const printer = await startVirtualPrinter(spoolDirectory, port);
console.log(`Impresora virtual escuchando en tcp://${printer.host}:${printer.port}`);
console.log(`Los tickets ESC/POS se guardarán en ${spoolDirectory}`);

const shutdown = async () => {
  await printer.close();
  process.exit(0);
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
