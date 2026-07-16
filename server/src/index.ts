import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createWatch,
  deleteWatch,
  getWatch,
  listHistory,
  listWatches,
  setEnabled,
  setInterval as setWatchInterval,
} from "./db.js";
import { checkWatch } from "./scheduler.js";
import { startScheduler } from "./scheduler.js";
import { closeBrowser } from "./checker.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = Fastify({ logger: false });

await app.register(cors, { origin: true });
await app.register(fastifyStatic, {
  root: path.resolve(__dirname, "../public"),
});

app.get("/api/watches", async () => listWatches());

app.post("/api/watches", async (req, reply) => {
  const body = req.body as {
    name?: string;
    url?: string;
    selector?: string;
    interval_minutes?: number;
    webhook_url?: string;
  };
  if (!body?.url || !body?.selector) {
    return reply.code(400).send({ error: "url と selector は必須です" });
  }
  const watch = createWatch({
    name: body.name?.trim() || body.url,
    url: body.url,
    selector: body.selector,
    interval_minutes: Math.max(1, Number(body.interval_minutes) || 30),
    webhook_url: body.webhook_url?.trim() || null,
  });
  // 登録直後に初回チェックを走らせて基準値を取る(失敗しても登録自体は成功)
  checkWatch(watch).catch((e) => console.error(`[initial check] ${watch.name}: ${e}`));
  return reply.code(201).send(watch);
});

app.delete("/api/watches/:id", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  if (!getWatch(id)) return reply.code(404).send({ error: "not found" });
  deleteWatch(id);
  return { ok: true };
});

app.patch("/api/watches/:id/enabled", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const watch = getWatch(id);
  if (!watch) return reply.code(404).send({ error: "not found" });
  const { enabled } = req.body as { enabled: boolean };
  setEnabled(id, !!enabled);
  return getWatch(id);
});

app.patch("/api/watches/:id/interval", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  if (!getWatch(id)) return reply.code(404).send({ error: "not found" });
  const minutes = Math.max(1, Number((req.body as { interval_minutes?: number }).interval_minutes));
  if (!Number.isFinite(minutes)) return reply.code(400).send({ error: "interval_minutes が不正です" });
  setWatchInterval(id, minutes);
  return getWatch(id);
});

app.post("/api/watches/:id/check", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  const watch = getWatch(id);
  if (!watch) return reply.code(404).send({ error: "not found" });
  try {
    const result = await checkWatch(watch);
    return { ...result, watch: getWatch(id) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return reply.code(502).send({ error: message });
  }
});

app.get("/api/watches/:id/history", async (req, reply) => {
  const id = Number((req.params as { id: string }).id);
  if (!getWatch(id)) return reply.code(404).send({ error: "not found" });
  return listHistory(id);
});

const port = Number(process.env.PORT) || 8787;
await app.listen({ port, host: "0.0.0.0" });
console.log(`ChangeNotifier server: http://localhost:${port}`);
startScheduler();

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    await closeBrowser();
    process.exit(0);
  });
}
