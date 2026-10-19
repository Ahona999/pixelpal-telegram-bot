import { InlineKeyboard } from "grammy";

export function mainMenu(): InlineKeyboard {
  return new InlineKeyboard()
    .text("🔎 Diagnose a UX Problem", "diagnose").row()
    .text("🎨 Critique My UI", "critique").row()
    .text("✍️ Improve UX Writing", "writing");
}
