/** A wake hint. The chat record and job rows are the source of truth; the hint only says which kind of wake arrived. */
export type SessionHint = { kind: "input" | "steer" | "job" | "side" };

export function sessionToken(chatId: string): string {
	return `session:${chatId}`;
}
