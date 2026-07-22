import { Socket } from "node:net";

export interface PrintTransport {
  send(bytes: Uint8Array): Promise<void>;
}

export interface TcpPrinterOptions {
  host: string;
  port?: number;
  connectTimeoutMs?: number;
  deliveryTimeoutMs?: number;
  connectAttempts?: number;
}

export class PrinterDeliveryError extends Error {
  constructor(message: string, readonly deliveryUnknown: boolean, options?: ErrorOptions) {
    super(message, options);
    this.name = "PrinterDeliveryError";
  }
}

function connect(options: Required<TcpPrinterOptions>) {
  return new Promise<Socket>((resolve, reject) => {
    const socket = new Socket();
    const timer = setTimeout(() => socket.destroy(new Error("printer_connect_timeout")), options.connectTimeoutMs);
    socket.once("error", reject);
    socket.connect(options.port, options.host, () => {
      clearTimeout(timer);
      socket.removeListener("error", reject);
      resolve(socket);
    });
  });
}

export class Tcp9100Printer implements PrintTransport {
  private readonly options: Required<TcpPrinterOptions>;

  constructor(options: TcpPrinterOptions) {
    this.options = {
      host: options.host,
      port: options.port ?? 9100,
      connectTimeoutMs: options.connectTimeoutMs ?? 2_000,
      deliveryTimeoutMs: options.deliveryTimeoutMs ?? 10_000,
      connectAttempts: options.connectAttempts ?? 3,
    };
  }

  async send(bytes: Uint8Array) {
    let socket: Socket | undefined;
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.connectAttempts; attempt += 1) {
      try {
        socket = await connect(this.options);
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!socket) throw new PrinterDeliveryError("printer_unreachable", false, { cause: lastError });

    await new Promise<void>((resolve, reject) => {
      let deliveryStarted = false;
      const timer = setTimeout(() => socket.destroy(new Error("printer_delivery_timeout")), this.options.deliveryTimeoutMs);
      socket.once("error", (error) => {
        clearTimeout(timer);
        reject(new PrinterDeliveryError("printer_delivery_failed", deliveryStarted, { cause: error }));
      });
      socket.once("close", (hadError) => {
        clearTimeout(timer);
        if (!hadError) resolve();
      });
      deliveryStarted = true;
      socket.end(bytes);
    });
  }
}
