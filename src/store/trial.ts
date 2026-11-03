/**
 * Install-wide trial record (data/trial.json). One code, one friend.
 * The invite code stays in the environment; this file only records that
 * it was redeemed and where the GPT-Sol session stands.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { INSTALL, activeUserId } from "../../config.ts";
import {
	EMPTY_TRIAL,
	TRIAL_DEEPSEEK_MODEL,
	type TrialRecord,
} from "../core/trial.ts";
import { CURRENT_SETTINGS_VERSION, type UserSettings } from "../core/settings.ts";

function readJson(file: string): unknown {
	try {
		return JSON.parse(fs.readFileSync(file, "utf-8"));
	} catch {
		return null;
	}
}

function writeJson(file: string, value: unknown): void {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	const tmp = `${file}.tmp-${crypto.randomUUID().slice(0, 8)}`;
	fs.writeFileSync(tmp, `${JSON.stringify(value, null, "\t")}\n`, "utf-8");
	fs.renameSync(tmp, file);
}

function sanitize(raw: unknown): TrialRecord {
	if (!raw || typeof raw !== "object") return { ...EMPTY_TRIAL };
	const r = raw as Record<string, unknown>;
	const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : undefined);
	return {
		version: 1,
		...(text(r.profileId) ? { profileId: text(r.profileId) } : {}),
		...(text(r.redeemedAt) ? { redeemedAt: text(r.redeemedAt) } : {}),
		...(text(r.solChatId) ? { solChatId: text(r.solChatId) } : {}),
		...(text(r.solEndedAt) ? { solEndedAt: text(r.solEndedAt) } : {}),
		...(text(r.accountId) ? { accountId: text(r.accountId) } : {}),
		...(text(r.signedUpAt) ? { signedUpAt: text(r.signedUpAt) } : {}),
	};
}

export function readTrialRecord(): TrialRecord {
	return sanitize(readJson(INSTALL.trial));
}

export function writeTrialRecord(record: TrialRecord): void {
	writeJson(INSTALL.trial, { ...record, version: 1 });
}

/** While this profile is the trial friend, every slot is DeepSeek V4.1
 *  Flash and background-role overrides cannot swap a support agent off it. */
export function applyTrialModelPins(record: UserSettings | null): UserSettings | null {
	const trial = readTrialRecord();
	const userId = activeUserId();
	if (!userId || trial.profileId !== userId) return record;
	const model = { provider: TRIAL_DEEPSEEK_MODEL.provider, id: TRIAL_DEEPSEEK_MODEL.id };
	const base: UserSettings = record ?? { version: CURRENT_SETTINGS_VERSION };
	const agent = base.agent;
	const { models: _dropped, ...agentRest } = agent ?? {};
	void _dropped;
	return {
		...base,
		version: base.version ?? CURRENT_SETTINGS_VERSION,
		models: {
			...base.models,
			strong: { ...base.models?.strong, model },
			cheap: { ...base.models?.cheap, model },
			vision: { ...base.models?.vision, model },
		},
		...(agent ? { agent: agentRest } : {}),
	};
}
