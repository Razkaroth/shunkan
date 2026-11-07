/**
 * Subscription credential documents. The file stores stay for their own
 * permission tests; hosted runs pass these into the web owner instead.
 */
import path from "node:path";
import { validateState as validateChatGPT } from "../server/subscription-native/chatgpt.cjs";
import { validateState as validateSubscription } from "../server/subscription-native/subscription-store.cjs";
import { authDirectory, readFileSync, writeFileSync } from "./data-file.ts";

function storageError(): Error {
	return Object.assign(new Error("storage"), { code: "storage" });
}

function readBody(file: string): string | null {
	try {
		return readFileSync(file, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw storageError();
	}
}

export function chatgptDocumentStore() {
	const file = path.join(authDirectory(), "chatgpt-credentials.json");
	return {
		async read() {
			const text = readBody(file);
			if (text === null) return null;
			try {
				return validateChatGPT(JSON.parse(text));
			} catch {
				throw storageError();
			}
		},
		async write(state: unknown) {
			try {
				validateChatGPT(state);
				writeFileSync(file, `${JSON.stringify(state)}\n`);
			} catch {
				throw storageError();
			}
		},
	};
}

export function subscriptionDocumentStore(providerId: "github-copilot" | "xai") {
	const file = path.join(authDirectory(), `${providerId}-credentials.json`);
	return {
		async read() {
			const text = readBody(file);
			if (text === null) return validateSubscription(providerId, { version: 1, allowBackgroundUse: true });
			try {
				return validateSubscription(providerId, JSON.parse(text));
			} catch {
				throw storageError();
			}
		},
		async write(state: unknown) {
			try {
				validateSubscription(providerId, state);
				writeFileSync(file, `${JSON.stringify(state)}\n`);
			} catch {
				throw storageError();
			}
		},
	};
}
