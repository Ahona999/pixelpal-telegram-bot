import { InlineKeyboard } from "grammy";
import { mainMenu } from "./menu.js";
import type { Mode } from "./types.js";

export const followups: Record<Mode, readonly string[]> = {
  diagnose: ["Explore assumptions", "Suggest research methods", "Challenge my hypothesis"],
  critique: ["Improve hierarchy", "Check accessibility", "Suggest alternatives"],
  writing: ["Make it shorter", "Make it friendlier", "Explain the changes"],
};

export function responseMenu(mode: Mode, token: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  followups[mode].forEach((label, index) => {
    keyboard.text(label, `follow:${token}:${index}`).row();
  });
  return keyboard.append(mainMenu());
}
