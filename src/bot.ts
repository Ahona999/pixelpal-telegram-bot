import { Bot, session } from "grammy";
import { registerCommands } from "./commands/index.js";
import { registerHandlers } from "./handlers/index.js";
import type { BotContext } from "./types.js";

export function createBot(token: string): Bot<BotContext> {
  const bot = new Bot<BotContext>(token);
  // Keep this companion in private chats and avoid mixing group members' tasks.
  bot.use(async (ctx, next) => {
    if (ctx.chat?.type !== "private") {
      if (ctx.callbackQuery) await ctx.answerCallbackQuery({ text: "Please open a private chat with @pixel_ux_bot." });
      else if (ctx.message) await ctx.reply("Let’s chat privately! Open @pixel_ux_bot and send /start.");
      return;
    }
    await next();
  });
  bot.use(session({ initial: () => ({}) }));
  registerCommands(bot);
  registerHandlers(bot);
  bot.catch(async ({ ctx }) => {
    // Raw errors can contain authenticated request URLs or user input.
    console.error("Could not process a Telegram update.");
    try {
      await ctx.reply("Something went wrong on my side. Please try again, or use /start to begin fresh.");
    } catch {
      console.error("Could not deliver the recovery message.");
    }
  });
  return bot;
}
