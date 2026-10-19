import type { Bot } from "grammy";
import { mainMenu } from "../menu.js";
import type { BotContext } from "../types.js";

export function registerCommands(bot: Bot<BotContext>): void {
  bot.command("start", async (ctx) => {
    ctx.session = {};
    await ctx.reply(
      "Hey, I’m PixelPal — your AI UX buddy! 👋\n\nLet’s think through tricky UX problems, review interfaces, and make words clearer. Pick a starting point below.\n\nI use a free AI model for feedback. Send follow-up messages to keep exploring. You can use /cancel anytime.",
      { reply_markup: mainMenu() },
    );
  });
  bot.command("help", async (ctx) => {
    await ctx.reply(
      "Here’s how we can work together:\n\n🔎 Diagnose: describe the user’s goal and where they get stuck.\n🎨 Critique: describe your interface in text (images are not processed yet).\n✍️ Writing: paste your copy and tell me who it’s for.\n\nChoose an option, then send your input. Keep chatting or use follow-up buttons. Feature buttons switch tasks and keep their separate context.\n\n/start — start fresh\n/help — see these tips\n/cancel — end the current task\n\nPlease leave out passwords and personal information.",
      { reply_markup: mainMenu() },
    );
  });
  bot.command("cancel", async (ctx) => {
    const active = ctx.session.mode !== undefined;
    ctx.session = {};
    await ctx.reply(active ? "All cleared! 🌱 What would you like to explore next?" : "No task in progress. Pick something to explore! 🌱", {
      reply_markup: mainMenu(),
    });
  });
}
