import { createNotionDependencies } from "@printdesk/backend";
import { buildNotionApp } from "./app.js";

const { worker } = createNotionDependencies();
const app = buildNotionApp(worker);
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
