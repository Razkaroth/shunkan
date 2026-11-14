import { sideConversationEntries } from "../core/side-chat.ts";
import { stores } from "./stores.ts";

/** Append new helper exchanges onto the durable transcript. Repeating the call adds nothing. */
export function publishSideEntries(chatId: string): void {
	const record = stores.chatStore.getChat(chatId);
	if (!record) return;
	const updates = sideConversationEntries(record);
	if (updates.length === 0) return;
	stores.chatStore.saveMessages(chatId, [...record.messages, ...updates]);
}
