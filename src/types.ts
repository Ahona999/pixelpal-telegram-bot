import type { Context, SessionFlavor } from "grammy";

export type Mode = "diagnose" | "critique" | "writing";
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}
export interface SessionData {
  mode?: Mode;
  histories?: Partial<Record<Mode, ChatMessage[]>>;
  followupToken?: string;
}
export type BotContext = Context & SessionFlavor<SessionData>;
