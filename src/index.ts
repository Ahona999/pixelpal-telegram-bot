import "dotenv/config";
import { createBot } from "./bot.js";

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.error("Missing TELEGRAM_BOT_TOKEN. Add it to your local .env file, then restart. See README.md.");
    process.exitCode = 1;
    return;
  }
  const bot = createBot(token);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      if (bot.isRunning()) void bot.stop();
    });
  }
  await bot.api.setMyCommands([
    { command: "start", description: "Meet PixelPal and choose a UX task" },
    { command: "help", description: "Get tips and available commands" },
    { command: "cancel", description: "Clear the current task" },
  ]);
  await bot.start({ onStart: () => console.log("PixelPal is running with long polling. Press Ctrl+C to stop.") });
}

main().catch(() => {
  console.error("PixelPal could not start or polling stopped. Check your token, internet connection, and that no other instance or webhook is using this bot. See README.md.");
  process.exitCode = 1;
});
