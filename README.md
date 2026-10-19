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

Keep one bot process running per token. Stop it with Ctrl+C. If startup fails, check the local token, connectivity, other running bot instances, and whether a previous deployment registered a webhook. Long polling requires that webhook to be removed from the previous deployment. Error logs deliberately omit raw errors to avoid exposing tokens or message content.

## Structure

```text
src/
  index.ts          # Environment, command menu, polling, shutdown
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
