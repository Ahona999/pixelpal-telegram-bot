import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage } from "node:http";
import { BotError, webhookCallback, type Bot } from "grammy";
import type { Update } from "grammy/types";
import type { BotContext } from "./types.js";

export function webhookConfig(env: NodeJS.ProcessEnv) {
  const url = new URL(env.WEBHOOK_URL ?? "");
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname === "/" || url.pathname === "/health") {
    throw new Error("WEBHOOK_URL must be an HTTPS URL with a dedicated path and no credentials, query, or fragment.");
  }
  const secret = env.TELEGRAM_WEBHOOK_SECRET ?? "";
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) {
    throw new Error("TELEGRAM_WEBHOOK_SECRET must contain 32–256 letters, digits, underscores, or hyphens.");
  }
  const port = Number(env.PORT ?? "10000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  return { url: url.href, path: url.pathname, secret, port };
}

async function readUpdate(req: IncomingMessage): Promise<Update> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_048_576) throw new Error("Webhook payload too large.");
    chunks.push(Buffer.from(chunk));
  }
  const update: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!update || typeof update !== "object" || !("update_id" in update) || !Number.isSafeInteger(update.update_id)) {
    throw new Error("Invalid Telegram update.");
  }
  return update as Update;
}

export function createWebhookServer(bot: Bot<BotContext>, config: ReturnType<typeof webhookConfig>) {
  // Match polling's ordered processing to avoid concurrent session writes.
  let queue = Promise.resolve();
  let pending = 0;
  const seen = new Set<number>();
  const deliver = webhookCallback(bot, "callback", {
    secretToken: config.secret,
    timeoutMilliseconds: Infinity,
  });
  const server = createServer(async (req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      return;
    }
    if (req.url !== config.path) { res.writeHead(404).end(); return; }
    if (req.method !== "POST") { res.writeHead(405, { Allow: "POST" }).end(); return; }
    const supplied = req.headers["x-telegram-bot-api-secret-token"];
    const expected = Buffer.from(config.secret);
    const actual = Buffer.from(typeof supplied === "string" ? supplied : "");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.writeHead(401).end();
      return;
    }
    if (!req.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
      res.writeHead(415).end(); return;
    }
    let update: Update;
    try { update = await readUpdate(req); }
    catch { res.writeHead(400).end(); return; }
    if (seen.has(update.update_id)) { res.writeHead(200).end(); return; }
    if (pending >= 100) { res.writeHead(503).end(); return; }
    seen.add(update.update_id);
    pending++;
    // Acknowledge before the 60-second AI call; send replies through the Bot API.
    res.writeHead(200).end();
    queue = queue.then(async () => {
      try {
        await deliver(update, () => {}, supplied);
      } catch (error) {
        // Webhook errors do not pass through bot.catch automatically.
        if (error instanceof BotError) await bot.errorHandler(error);
        else console.error("Could not process a webhook update.");
      }
    }).catch(() => {
      console.error("Could not recover from a webhook update failure.");
    }).finally(() => {
      pending--;
      // Bound duplicate tracking; no update content or credentials are stored here.
      if (seen.size > 1000) seen.delete(seen.values().next().value!);
    });
  });
  server.requestTimeout = 15_000;
  return { server, drain: () => queue };
}
