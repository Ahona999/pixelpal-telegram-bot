import "dotenv/config";
import { createBot } from "./bot.js";
import { createWebhookServer, webhookConfig } from "./webhook.js";

async function main(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.error("Missing TELEGRAM_BOT_TOKEN. Add it to your local .env file, then restart. See README.md.");
    process.exitCode = 1;
    return;
  }
  const bot = createBot(token);
  const mode = process.env.BOT_MODE?.trim() || "polling";
  if (mode !== "polling" && mode !== "webhook") throw new Error("Invalid BOT_MODE.");
  const config = mode === "webhook" ? webhookConfig(process.env) : undefined;
  let shutdownServer: (() => void) | undefined;
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      if (bot.isRunning()) void bot.stop();
      shutdownServer?.();
    });
  }
  await bot.api.setMyCommands([
    { command: "start", description: "Meet PixelPal and choose a UX task" },
    { command: "help", description: "Get tips and available commands" },
    { command: "cancel", description: "Clear the current task" },
  ]);
  if (config) {
    await bot.init();
    const { server, drain } = createWebhookServer(bot, config);
    shutdownServer = () => {
      server.close(() => { void drain(); });
    };
    server.on("error", () => {
      console.error("PixelPal HTTP server failed.");
      process.exitCode = 1;
      server.close();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(config.port, "0.0.0.0", () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    try {
      await bot.api.setWebhook(config.url, {
        secret_token: config.secret,
        allowed_updates: ["message", "callback_query"],
        max_connections: 1,
      });
    } catch {
      server.close();
      throw new Error("Webhook registration failed.");
    }
    console.log("PixelPal is running in webhook mode.");
  } else {
    // Switching back to local polling must remove the old webhook first.
    await bot.api.deleteWebhook({ drop_pending_updates: false });
    await bot.start({ onStart: () => console.log("PixelPal is running with long polling. Press Ctrl+C to stop.") });
  }
}

main().catch(() => {
  console.error("PixelPal could not start or stopped. Check environment configuration, connectivity, and that no other instance is using this bot. See README.md.");
  process.exitCode = 1;
});
