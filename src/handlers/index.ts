import { randomBytes } from "node:crypto";
import type { Bot } from "grammy";
import { AIError, getFeedback, HISTORY_LIMIT, INPUT_LIMIT, splitReply } from "../ai.js";
import { followups, responseMenu } from "../followups.js";
import { mainMenu } from "../menu.js";
import type { BotContext, Mode } from "../types.js";

const prompts: Record<Mode, string> = {
  diagnose: "Let’s untangle it together! 🔎\n\nWhat is the user trying to do, where do they get stuck, and what did you expect to happen? Send a short description.\n\n/cancel to start over.",
  critique: "Let’s take a fresh look! 🎨\n\nDescribe your interface in text (screenshots are not processed yet). If you can, include who it’s for and the main action they should take.\n\n/cancel to start over.",
  writing: "Let’s make every word count! ✍️\n\nPaste the UX copy you’d like to improve. Tell me where it appears, who will read it, and the tone you’re aiming for.\n\n/cancel to start over.",
};

const thinking: Record<Mode, string> = {
  diagnose: "PixelPal is thinking through your UX problem…",
  critique: "PixelPal is reviewing your UI…",
  writing: "✍️ PixelPal is polishing your copy…",
};

function startTyping(ctx: BotContext, chatId: number): () => Promise<void> {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  let pending: Promise<void>;
  const refresh = async (): Promise<void> => {
    try {
      const signal = AbortSignal.any([
        controller.signal, AbortSignal.timeout(4000),
      ]);
      // grammY types use the legacy AbortSignal shim; Node's native signal
      // supports the same runtime cancellation interface.
      await ctx.api.sendChatAction(chatId, "typing", {}, signal as unknown as Parameters<typeof ctx.api.sendChatAction>[3]);
    } catch {
      // A cosmetic Telegram failure must not interrupt AI feedback.
    }
    if (!stopped) timer = setTimeout(() => { pending = refresh(); }, 4000);
  };
  pending = refresh();
  return async () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
    await pending;
  };
}

export function registerHandlers(bot: Bot<BotContext>): void {
  const activeChats = new Set<number>();
  for (const mode of ["diagnose", "critique", "writing"] as const) {
    bot.callbackQuery(mode, async (ctx) => {
      await ctx.answerCallbackQuery();
      ctx.session = { mode, histories: ctx.session.histories ?? {} };
      await ctx.reply(prompts[mode]);
    });
  }
  bot.callbackQuery(/^follow:([a-f0-9]{24}):([0-2])$/, async (ctx) => {
    const mode = ctx.session.mode;
    const token = ctx.match[1];
    const index = Number(ctx.match[2]);
    if (!mode || ctx.session.followupToken !== token || !ctx.session.histories?.[mode]?.length) {
      await ctx.answerCallbackQuery({ text: "This follow-up has expired. Send a message or choose a feature." });
      return;
    }
    if (activeChats.has(ctx.chat!.id)) {
      await ctx.answerCallbackQuery({ text: "I'm still working on your previous message." });
      return;
    }
    // Consume before awaiting so repeated/queued taps cannot duplicate a request.
    ctx.session.followupToken = undefined;
    await ctx.answerCallbackQuery();
    await respond(ctx, mode, followups[mode][index]);
  });
  bot.on("callback_query:data", async (ctx) => {
    await ctx.answerCallbackQuery({ text: "Let’s pick a fresh option with /start." });
  });
  bot.on("message", async (ctx) => {
    const text = ctx.message.text?.trim();
    if (text?.startsWith("/")) {
      await ctx.reply("I don’t know that command yet. Try /start, /help, or /cancel.");
      return;
    }
    const mode = ctx.session.mode;
    if (!mode) {
      await ctx.reply("Happy to help! Choose an option first so I know where to begin. 👇", { reply_markup: mainMenu() });
      return;
    }
    if (!text) {
      await ctx.reply(mode === "critique"
        ? "I cannot analyze images yet. Please describe the interface in a text message. You can also use /cancel."
        : "Please send your input as a text message so we can get started. You can also use /cancel.");
      return;
    }
    if (text.length > INPUT_LIMIT) {
      await ctx.reply(`Please shorten your message to ${INPUT_LIMIT} characters so we can keep the conversation focused.`);
      return;
    }
    await respond(ctx, mode, text);
  });

  async function respond(ctx: BotContext, mode: Mode, text: string): Promise<void> {
    const chatId = ctx.chat!.id;
    const session = ctx.session;
    const history = session.histories?.[mode] ?? [];
    if (activeChats.has(chatId)) {
      await ctx.reply("I'm still thinking through your previous message. Please wait for that reply.");
      return;
    }
    activeChats.add(chatId);
    let stopTyping = startTyping(ctx, chatId);
    let acknowledgementId: number | undefined;
    try {
      try {
        const acknowledgement = await ctx.reply(thinking[mode]);
        acknowledgementId = acknowledgement.message_id;
      } catch {
        // Continue even if the temporary acknowledgement cannot be delivered.
      }
      // Sending a message clears Telegram's typing status; restore it immediately.
      await stopTyping();
      stopTyping = startTyping(ctx, chatId);
      let reply: string;
      try {
        reply = await getFeedback(mode, history, text);
      } finally {
        await stopTyping();
      }
      if (ctx.session !== session) return;
      const token = randomBytes(12).toString("hex");
      const chunks = splitReply(reply);
      for (const [index, chunk] of chunks.entries()) {
        await ctx.reply(chunk, index === chunks.length - 1
          ? { reply_markup: responseMenu(mode, token) } : {});
      }
      session.followupToken = token;
      session.histories ??= {};
      session.histories[mode] = [
        ...history,
        { role: "user" as const, content: text },
        { role: "assistant" as const, content: reply },
      ].slice(-HISTORY_LIMIT);
    } catch (error) {
      if (!(error instanceof AIError)) throw error;
      if (ctx.session === session) await ctx.reply(error.message);
    } finally {
      await stopTyping();
      if (acknowledgementId !== undefined) {
        try {
          await ctx.api.deleteMessage(chatId, acknowledgementId);
        } catch {
          console.error("Could not delete the temporary thinking message.");
        }
      }
      activeChats.delete(chatId);
    }
  }
}
