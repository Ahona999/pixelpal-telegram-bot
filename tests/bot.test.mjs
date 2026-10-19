import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as nextTurn } from "node:timers/promises";
import { createBot } from "../dist/bot.js";
import { followups } from "../dist/followups.js";
function harness(t) {
    const originalEnv = { ...process.env };
    t.after(() => { process.env = originalEnv; });
    process.env.OPENROUTER_API_KEY = "mock-key";
    process.env.OPENROUTER_MODEL = "test/model:free";
    const bot = createBot("123:mock-token");
    bot.botInfo = { id: 123, is_bot: true, first_name: "PixelPal", username: "pixelpal_test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false };
    const telegram = [];
    const requests = [];
    let nextId = 1;
    let deletionFails = false;
    let respond = async () => Response.json({ choices: [{ message: { content: "Concise UX feedback." } }] });
    t.mock.method(globalThis, "fetch", async (_url, options) => {
        requests.push(JSON.parse(options.body));
        return respond();
    });
    bot.api.config.use(async (_previous, method, payload) => {
        telegram.push({ method, payload });
        if (method === "deleteMessage" && deletionFails) throw new Error("Synthetic deletion failure");
        if (method === "sendMessage")
            return { ok: true, result: { message_id: nextId++, date: 0, chat: { id: payload.chat_id, type: "private" }, text: payload.text } };
        return { ok: true, result: true };
    });
    const user = { id: 1, is_bot: false, first_name: "Test" };
    const chat = (id) => ({ id, type: "private", first_name: "Test" });
    let updateId = 1;
    return {
        telegram, requests,
        setResponse(fn) { respond = fn; },
        failDeletion() { deletionFails = true; },
        async text(text, id = 1) {
            await bot.handleUpdate({ update_id: updateId++, message: { message_id: nextId++, date: 0, chat: chat(id), from: { ...user, id }, text, ...(text.startsWith("/") ? { entities: [{ type: "bot_command", offset: 0, length: text.length }] } : {}) } });
        },
        async tap(data, id = 1) {
            await bot.handleUpdate({ update_id: updateId++, callback_query: { id: String(updateId), from: { ...user, id }, chat_instance: "mock", data, message: { message_id: 1, date: 0, chat: chat(id), text: "Earlier menu" } } });
        },
        async photo() {
            await bot.handleUpdate({ update_id: updateId++, message: { message_id: nextId++, date: 0, chat: chat(1), from: user, photo: [{ file_id: "mock", file_unique_id: "mock", width: 10, height: 10 }] } });
        },
        buttons() {
            return telegram.filter(x => x.method === "sendMessage" && x.payload.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data?.startsWith("follow:"))
                .at(-1).payload.reply_markup.inline_keyboard.flat();
        },
    };
}
for (const mode of ["diagnose", "critique", "writing"]) {
    test(`${mode}: selection, text, all follow-ups, free-form context, cleanup`, async (t) => {
        const h = harness(t);
        await h.tap(mode);
        assert.equal(h.requests.length, 0);
        await h.text(`Synthetic ${mode} description`);
        assert.equal(h.requests.length, 1);
        assert.equal(h.requests[0].messages.at(-1).content, `Synthetic ${mode} description`);
        assert.match(h.requests[0].messages[0].content, /80-130 words/);
        assert.equal(h.requests[0].model, "test/model:free");
        assert.deepEqual(h.requests[0].provider, { allow_fallbacks: false, max_price: { prompt: 0, completion: 0 } });
        for (const label of followups[mode]) {
            const buttons = h.buttons();
            assert.deepEqual(buttons.slice(0, 3).map(x => x.text), followups[mode]);
            assert.ok(buttons.every(x => Buffer.byteLength(x.callback_data) <= 64));
            assert.ok(buttons.some(x => x.callback_data === "diagnose"));
            const button = buttons.find(x => x.text === label);
            const before = h.requests.length;
            await h.tap(button.callback_data);
            assert.equal(h.requests.length, before + 1);
            assert.equal(h.requests.at(-1).messages.at(-1).content, label);
            assert.ok(h.requests.at(-1).messages.some((x) => x.role === "assistant"));
            await h.tap(button.callback_data);
            assert.equal(h.requests.length, before + 1, "Consumed token rejects repeated tap");
        }
        await h.text("A free-form follow-up");
        assert.equal(h.requests.at(-1).messages.at(-1).content, "A free-form follow-up");
        assert.ok(h.requests.at(-1).messages.length <= 10);
        const actions = h.telegram.filter(x => x.method === "sendChatAction");
        assert.ok(actions.every(x => x.payload.action === "typing"));
        assert.ok(actions.length >= 2 * h.requests.length);
        assert.equal(h.telegram.filter(x => x.method === "deleteMessage").length, h.requests.length);
    });
}
test("stale buttons after cancel, start, mode change and returning to a mode", async (t) => {
    const h = harness(t);
    for (const action of ["/cancel", "/start", "critique"]) {
        await h.tap("diagnose");
        await h.text("Synthetic problem");
        const old = h.buttons()[0].callback_data;
        if (action.startsWith("/"))
            await h.text(action);
        else
            await h.tap(action);
        const before = h.requests.length;
        await h.tap(old);
        assert.equal(h.requests.length, before);
        assert.match(h.telegram.at(-1).payload.text, /expired/);
        await h.tap("diagnose");
        await h.tap(old);
        assert.equal(h.requests.length, before);
    }
});
test("history is isolated by chat and mode; screenshots request text", async (t) => {
    const h = harness(t);
    await h.tap("diagnose");
    await h.text("Diagnosis context");
    await h.tap("critique");
    await h.photo();
    assert.equal(h.requests.length, 1);
    assert.match(h.telegram.at(-1).payload.text, /cannot analyze images/);
    await h.text("Text interface description");
    assert.ok(!h.requests.at(-1).messages.some((x) => x.content === "Diagnosis context"));
    await h.tap("diagnose");
    await h.text("Continue diagnosis");
    assert.ok(h.requests.at(-1).messages.some((x) => x.content === "Diagnosis context"));
    await h.tap("diagnose", 2);
    await h.text("Another chat", 2);
    assert.equal(h.requests.at(-1).messages.length, 2);
});
test("repeated taps and simultaneous submissions cannot overlap API requests", async (t) => {
    const h = harness(t);
    await h.tap("writing");
    await h.text("Original copy");
    const button = h.buttons()[0].callback_data;
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    h.setResponse(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const pending = h.tap(button);
    await ready;
    await h.tap(button);
    await h.text("Concurrent text");
    assert.equal(h.requests.length, 2);
    release(Response.json({ choices: [{ message: { content: "Shorter copy" } }] }));
    await pending;
    assert.equal(h.requests.length, 2);
});
test("typing refresh stops after completion and failed deletion is harmless", async (t) => {
    const h = harness(t);
    t.mock.timers.enable({ apis: ["setTimeout"] });
    t.mock.method(console, "error", () => {});
    h.failDeletion();
    await h.tap("critique");
    let release;
    let started;
    const ready = new Promise(resolve => { started = resolve; });
    h.setResponse(() => { started(); return new Promise(resolve => { release = resolve; }); });
    const pending = h.text("Synthetic UI description");
    await ready;
    await nextTurn();
    const actionCount = () => h.telegram.filter(x => x.method === "sendChatAction").length;
    const initial = actionCount();
    t.mock.timers.tick(4000);
    await nextTurn();
    assert.ok(actionCount() > initial);
    release(Response.json({ choices: [{ message: { content: "Feedback" } }] }));
    await pending;
    const finished = actionCount();
    t.mock.timers.tick(12000);
    await nextTurn();
    assert.equal(actionCount(), finished);
    assert.equal(h.telegram.at(-1).method, "deleteMessage");
    h.setResponse(async () => Response.json({ choices: [{ message: { content: "Retry feedback" } }] }));
    await h.text("Another request");
    assert.equal(h.requests.length, 2);
});

test("local timeout preserves mode/history, clears thinking, permits manual retry", async (t) => {
    const h = harness(t);
    await h.tap("diagnose");
    await h.text("Earlier context");
    const nativeTimeout = AbortSignal.timeout;
    t.mock.method(AbortSignal, "timeout", (ms) => {
        if (ms !== 60_000)
            return nativeTimeout(ms);
        return AbortSignal.abort();
    });
    t.mock.method(console, "error", () => { });
    h.setResponse(async () => { throw new Error("Synthetic timeout"); });
    await h.text("Timed-out input");
    assert.ok(h.telegram.some(x => x.payload.text?.includes("PixelPal is taking longer than expected")));
    assert.equal(h.telegram.at(-1).method, "deleteMessage");
    h.setResponse(async () => Response.json({ choices: [{ message: { content: "Retry feedback" } }] }));
    await h.text("Manual retry");
    assert.equal(h.requests.length, 3);
    assert.ok(h.requests.at(-1).messages.some((x) => x.content === "Earlier context"));
    assert.ok(!h.requests.at(-1).messages.some((x) => x.content === "Timed-out input"));
});
test("API errors are sanitized and do not retry", async (t) => {
    const h = harness(t);
    const logs = [];
    t.mock.method(console, "error", (...args) => { logs.push(args); });
    await h.tap("critique");
    for (const status of [400, 401, 402, 429, 503, 504]) {
        h.setResponse(async () => Response.json({ error: { message: "untrusted mock-key Synthetic private input" } }, { status }));
        const count = h.requests.length;
        await h.text("Synthetic private input");
        assert.equal(h.requests.length, count + 1);
        assert.equal(h.telegram.at(-1).method, "deleteMessage");
    }
    assert.ok(!JSON.stringify(logs).includes("mock-key"));
    assert.ok(!JSON.stringify(logs).includes("Synthetic private input"));
    process.env.OPENROUTER_MODEL = "test/paid";
    const before = h.requests.length;
    await h.text("Synthetic input");
    assert.equal(h.requests.length, before);
});
