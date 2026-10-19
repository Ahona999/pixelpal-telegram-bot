# PixelPal v1.1 — Your AI UX Buddy

A friendly Telegram UX thinking companion for **@pixel_ux_bot**, built with TypeScript, Node.js, grammY, and dotenv.

## Local setup

1. Install Node.js 22 or later and run `npm install` in this directory.
2. Copy `.env.example` to `.env` (PowerShell: `Copy-Item .env.example .env`).
3. Open `.env` in your local editor. Privately obtain the token for @pixel_ux_bot from Telegram’s verified @BotFather and paste it after `TELEGRAM_BOT_TOKEN=`. Save the file. Never paste the token into chat, source code, screenshots, or terminal commands. `.env` is ignored by Git.
4. Set `OPENROUTER_API_KEY` and `OPENROUTER_MODEL` in `.env`. Use a specific free model ID ending in `:free`; the placeholder in `.env.example` must be replaced. Paid IDs and automatic routers are rejected.
5. Run `npm run dev`.
6. Open https://t.me/pixel_ux_bot in Telegram and send `/start`.

On Windows, if PowerShell blocks `npm.ps1`, use `npm.cmd` instead of `npm` for these commands. No execution policy change is needed.

## Commands and behavior

- `/start`: reset the current task and show three native inline buttons.
- **🔎 Diagnose a UX Problem**: asks for the user’s goal, problem, and expected outcome.
- **🎨 Critique My UI**: asks for a text description with context; screenshots are not processed.
- **✍️ Improve UX Writing**: asks for existing copy, audience, placement, and tone.
- `/help`: explain the flow and show the menu without clearing an active task.
- `/cancel`: clear the current task and return to the menu.

After receiving text, PixelPal generates mode-specific feedback through OpenRouter chat completions. Continue with follow-up messages in the same task, or use a follow-up button or switch features with the original menu. Unsupported attachments and unknown commands receive guidance without losing the active task. Feature buttons switch the selected task. Follow-up buttons use the latest successful response and expire when consumed, replaced by a new response, or after a feature change, `/start`, or `/cancel`. Repeated taps cannot start overlapping AI requests. Use a private chat; groups are directed to the bot’s private chat.

History is isolated per private chat and per UX mode, retaining at most four user/assistant exchanges in each mode. Switching modes preserves their separate histories. Inputs are limited to 4,000 characters, stored assistant replies to 6,000 characters, and generation to 800 tokens. `/start`, `/cancel`, or restarting clears all history. History is held in memory with no database or application content logging. Submitted text is sent through Telegram, OpenRouter, and the configured model provider, whose retention policies apply.

Each AI request has a 60-second timeout and no automatic retries. Only the configured `:free` model is used, with provider fallbacks disabled and prompt/completion price ceilings of zero. Rate limits, unavailable models, account/credit errors, timeouts, and empty responses produce safe guidance while preserving the conversation. No paid model fallback is used. Replies are sent as plain text in chunks of at most 4,000 UTF-16 code units.

## Development

```sh
npm run dev        # Long polling with automatic reload
npm run typecheck  # TypeScript validation without output
npm run build     # Compile into dist/
npm start         # Run the compiled bot
npm test          # Build and run mocked Telegram/OpenRouter tests
```

Keep one bot process running per token. Stop it with Ctrl+C. If startup fails, check the local token, connectivity, and other running bot instances. Polling startup removes an existing webhook automatically; stop the remote instance first so it cannot register the webhook again. Error logs deliberately omit raw errors to avoid exposing tokens or message content.

## Structure

```text
src/
  index.ts          # Environment, command menu, polling/webhook startup, shutdown
  webhook.ts        # Authenticated webhook server, health, ordered delivery
  bot.ts            # Bot factory, session middleware, error handling
  commands/index.ts # /start, /help, /cancel
  handlers/index.ts # Inline buttons, input validation, fallbacks
  menu.ts           # Native Telegram inline keyboard
  types.ts          # Typed conversation state
  ai.ts             # Free-only OpenRouter client, prompts, bounded replies
  followups.ts      # Mode-specific follow-up actions and response menus
```

## Manual smoke check

With your local token configured, send `/start`, try each button and submit text, send follow-up text, then try a screenshot photo in the critique flow and verify it requests a text description. Verify `/cancel` clears the task, `/help` explains it, and an unknown command or unsupported attachment gets useful guidance. Restart the bot and confirm the previous task is cleared. Live Telegram verification requires your local token.

Implementation reference: [grammY commands documentation](https://grammy.dev/guide/commands).

To restart the compiled bot: stop the running instance with Ctrl+C, then run `npm run build; if ($LASTEXITCODE -eq 0) { npm start }` in PowerShell. Keep only one polling instance running.

API references: [OpenRouter chat completions](https://openrouter.ai/docs/api/api-reference/chat/send-chat-completion-request), [provider price limits and fallbacks](https://openrouter.ai/docs/guides/routing/provider-selection).

Version 1.1 aims for conversational replies of approximately 80-130 words, with focused feedback and one follow-up. Reply length is model-guided rather than a hard word cutoff. Thinking messages and native typing indicators stay active during generation and are cleaned up afterward. Tests mock both Telegram and OpenRouter; they make no paid or live API calls.

## Render Free web service (setup only; nothing deployed)

Use a **Node Web Service** with the **Free** instance type. Build command: `npm ci --include=dev && npm run build`. Start command: `npm start`. Health check path: `/health`. The HTTP server binds to `0.0.0.0` using Render's `PORT` variable (local webhook default: `10000`). Node.js 22 or later is required; you can set `NODE_VERSION=22` in Render.

Set these environment variables privately in the Render dashboard:

| Name | Value |
| --- | --- |
| `BOT_MODE` | `webhook` |
| `TELEGRAM_BOT_TOKEN` | Your existing Telegram bot token |
| `OPENROUTER_API_KEY` | Your existing OpenRouter API key |
| `OPENROUTER_MODEL` | Your existing specific model ID ending in `:free` |
| `WEBHOOK_URL` | The full public HTTPS endpoint, e.g. `https://your-service.onrender.com/telegram/webhook` |
| `TELEGRAM_WEBHOOK_SECRET` | A newly generated random secret, 32–256 characters using letters, digits, `_` or `-` |
| `PORT` | Supplied automatically by Render; no manual setting required |

Generate the webhook secret with a password manager (64 random hexadecimal characters is suitable). Keep it separate from the Telegram token and OpenRouter key. Do not put secrets in the URL or commit `.env`. `.env.example` contains placeholders only. The path in `WEBHOOK_URL` becomes the webhook route; `/health` is reserved. Telegram sends the secret in `X-Telegram-Bot-Api-Secret-Token`; the server rejects missing or incorrect values, and grammY validates it again.

Startup registers the webhook automatically with Telegram, without dropping pending updates. Stop the local polling instance before starting the Render service. No manual `curl` command with tokens is needed. In webhook mode the bot does not start polling. On shutdown it stops accepting HTTP connections while already accepted work drains; it leaves the registered webhook in place for the next start.

The server acknowledges authenticated, valid updates before slow AI generation, processes them in order, and suppresses duplicate update IDs within a bounded in-memory window. Replies, typing actions, and temporary-message cleanup still use the Telegram Bot API. Delivery state and conversations are in memory: a crash, redeploy, or free-service sleep clears them, and accepted work interrupted by shutdown can be lost. This setup is suitable for the zero-budget hobby project, with no durable queue or paid services added.

Render Free services sleep after 15 minutes without inbound traffic; the next request wakes them and can experience a cold start. Free instance hours and other usage limits still apply. See [Render Free limits](https://render.com/docs/free) and [port binding](https://render.com/docs/web-services#port-binding). Webhooks use [grammY webhook support](https://grammy.dev/guide/deployment-types).

For local development, stop the Render service first, set `BOT_MODE=polling` (the default when omitted), then run `npm.cmd run dev`, or `npm.cmd run build` followed by `npm.cmd start`. Polling startup removes any existing webhook without dropping pending updates. Run only one instance per Telegram token. Switch `BOT_MODE` back to `webhook` when returning to Render; startup registers the configured webhook again.
