import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createWebhookServer, webhookConfig } from "../dist/webhook.js";

const env = {
  WEBHOOK_URL: "https://example.invalid/telegram/webhook",
  TELEGRAM_WEBHOOK_SECRET: "a".repeat(64),
  PORT: "10000",
};

function harness(handleUpdate = async () => {}) {
  const bot = { isRunning: () => false, init: async () => {}, handleUpdate, errorHandler: async () => {} };
  const instance = createWebhookServer(bot, webhookConfig(env));
  return {
    ...instance,
    request({ method = "POST", url = "/telegram/webhook", secret = env.TELEGRAM_WEBHOOK_SECRET, body = '{"update_id":1}', type = "application/json" } = {}) {
      const req = Readable.from([Buffer.from(body)]);
      Object.assign(req, { method, url, headers: { "content-type": type, ...(secret === null ? {} : { "x-telegram-bot-api-secret-token": secret }) } });
      return new Promise(resolve => {
        const res = {
          status: 200,
          writeHead(status) { this.status = status; return this; },
          end(body) { resolve({ status: this.status, body }); },
        };
        instance.server.emit("request", req, res);
      });
    },
  };
}

test("webhook configuration requires HTTPS, dedicated path, secret and valid port", () => {
  assert.deepEqual(webhookConfig(env), { url: env.WEBHOOK_URL, path: "/telegram/webhook", secret: env.TELEGRAM_WEBHOOK_SECRET, port: 10000 });
  for (const changes of [
    { WEBHOOK_URL: "http://example.invalid/hook" },
    { WEBHOOK_URL: "https://example.invalid/" },
    { WEBHOOK_URL: "https://example.invalid/health" },
    { WEBHOOK_URL: "https://example.invalid/hook?secret=x" },
    { TELEGRAM_WEBHOOK_SECRET: "" },
    { TELEGRAM_WEBHOOK_SECRET: "a b".repeat(20) },
    { PORT: "invalid" },
  ]) assert.throws(() => webhookConfig({ ...env, ...changes }));
});

test("health, routing, authentication, JSON and payload limits", async () => {
  let calls = 0;
  const h = harness(async () => { calls++; });
  assert.deepEqual(await h.request({ method: "GET", url: "/health", secret: null }), { status: 200, body: "ok" });
  assert.equal((await h.request({ url: "/unknown" })).status, 404);
  assert.equal((await h.request({ method: "GET" })).status, 405);
  assert.equal((await h.request({ secret: null })).status, 401);
  assert.equal((await h.request({ secret: "incorrect" })).status, 401);
  assert.equal((await h.request({ type: "text/plain" })).status, 415);
  assert.equal((await h.request({ body: "invalid JSON" })).status, 400);
  assert.equal((await h.request({ body: "{}" })).status, 400);
  assert.equal((await h.request({ body: "x".repeat(1_048_577) })).status, 400);
  assert.equal(calls, 0);
  h.server.close();
});

test("acknowledges slow updates immediately, processes in order, suppresses duplicates", async () => {
  const received = [];
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const h = harness(async update => {
    received.push(update.update_id);
    if (update.update_id === 1) await pending;
  });
  assert.equal((await h.request()).status, 200);
  await nextTurn();
  assert.deepEqual(received, [1]);
  assert.equal((await h.request()).status, 200);
  assert.equal((await h.request({ body: '{"update_id":2}' })).status, 200);
  assert.equal((await h.request({ method: "GET", url: "/health" })).status, 200);
  assert.deepEqual(received, [1]);
  release();
  await h.drain();
  assert.deepEqual(received, [1, 2]);
  h.server.close();
});

test("failed update is logged safely and does not block the next update", async t => {
  const logs = [];
  t.mock.method(console, "error", (...args) => { logs.push(args); });
  const received = [];
  const h = harness(async update => {
    received.push(update.update_id);
    if (update.update_id === 1) throw new Error("sensitive synthetic payload");
  });
  await h.request();
  await h.request({ body: '{"update_id":2}' });
  await h.drain();
  assert.deepEqual(received, [1, 2]);
  assert.ok(logs.length);
  assert.ok(!JSON.stringify(logs).includes("sensitive"));
  h.server.close();
});
