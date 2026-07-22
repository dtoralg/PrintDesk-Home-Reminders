import { createRenderDependencies } from "@printdesk/backend";
import { buildRenderApp } from "./app.js";

const { worker } = createRenderDependencies();
const app = buildRenderApp(worker);
await app.listen({ host: "0.0.0.0", port: Number(process.env.PORT ?? 8080) });
