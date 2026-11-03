/**
 * University trial: one invite code, DeepSeek on every agent tier, one
 * GPT-Sol session, then a signup before anything else runs. Public email
 * signup stays disabled. This module creates the one account the trial
 * needs. It does not create prices, products, or a student billing system.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
import { activeUserId, runAsUser, userDataDir } from "../../config.ts";
import { isAppLanguage, type AppLanguage } from "../core/i18n.ts";
import {
	TRIAL_DEEPSEEK_MODEL,
	TRIAL_SIGNUP_REQUIRED,
	TRIAL_SOL_MODEL,
	trialConversationModel,
	trialPublicStatus,
	type TrialPublicStatus,
	type TrialRecord,
} from "../core/trial.ts";
import {
	isProfileColor,
	isValidPin,
	normalizeProfileName,
	profileNameProblem,
	type Profile,
	type ProfileColor,
} from "../core/users.ts";
import { chatStore } from "../store/chats.ts";
import { writeSettings } from "../store/settings.ts";
import { readTrialRecord, writeTrialRecord } from "../store/trial.ts";
import {
	createSession,
	mintUserId,
	readProfiles,
	writeProfiles,
} from "../store/users.ts";
import { hasUnclaimedData, requestProfile, UsersError } from "./users.ts";

export class TrialError extends Error {
	constructor(
		public readonly status: number,
		message: string,
		public readonly code?: string,
	) {
		super(message);
		this.name = "TrialError";
	}
}

export interface TrialAccountInput {
	email: string;
	name: string;
	password: string;
}

export type TrialAccountCreator = (input: TrialAccountInput) => Promise<{ id: string }>;

const SIGNUP_REQUIRED_MESSAGE = "Sign up to continue. The GPT-Sol session has ended.";

function configuredCode(): string | undefined {
	const code = process.env.TRIAL_INVITE_CODE?.trim();
	return code ? code : undefined;
}

function codesMatch(provided: string, expected: string): boolean {
	const a = createHash("sha256").update(provided).digest();
	const b = createHash("sha256").update(expected).digest();
	return timingSafeEqual(a, b);
}

function participantRecord(profileId: string): TrialRecord {
	const record = readTrialRecord();
	if (record.profileId !== profileId) throw new TrialError(403, "This profile is not on the university trial.");
	return record;
}

export function trialStatusFor(profileId: string | null): TrialPublicStatus {
	return trialPublicStatus({
		codeConfigured: !!configuredCode(),
		record: readTrialRecord(),
		profileId,
	});
}

export function trialStatusForRequest(req: Request | undefined): TrialPublicStatus {
	return trialStatusFor(requestProfile(req)?.id ?? null);
}

/** 403 when this trial friend must sign up before another model call. */
export function trialBlockResponse(): Response | null {
	const status = trialStatusFor(activeUserId() ?? null);
	if (!status.signupRequired) return null;
	return Response.json({ error: SIGNUP_REQUIRED_MESSAGE, code: TRIAL_SIGNUP_REQUIRED }, { status: 403 });
}

/** Conversation pin for the signed-in trial friend, if any. */
export function trialMainModel(chatId: string): { provider: string; id: string } | undefined {
	return trialConversationModel(readTrialRecord(), activeUserId(), chatId);
}

/** The first successful reply on the Sol chat ends that session. */
export function noteSolSessionEnded(profileId: string | undefined, chatId: string): void {
	if (!profileId) return;
	const record = readTrialRecord();
	if (record.profileId !== profileId || record.solChatId !== chatId || record.solEndedAt) return;
	writeTrialRecord({ ...record, solEndedAt: new Date().toISOString() });
}

interface RedeemInput {
	code?: unknown;
	name?: unknown;
	color?: unknown;
	pin?: unknown;
	language?: unknown;
}

export function redeemTrialCode(
	req: Request | undefined,
	input: RedeemInput,
): { profileId: string; sessionId: string | null } {
	const expected = configuredCode();
	if (!expected) throw new TrialError(404, "This install has no trial code.");
	if (typeof input.code !== "string" || input.code.trim() === "") throw new TrialError(400, "Enter the invite code.");
	if (!codesMatch(input.code.trim(), expected)) throw new TrialError(403, "That code does not match.");
	if (readTrialRecord().profileId) throw new TrialError(409, "This trial code is already redeemed.");
	if (hasUnclaimedData()) {
		throw new TrialError(409, "The owner needs to open the app once before this code can be redeemed.");
	}
	const profiles = readProfiles();
	if (typeof input.name !== "string") throw new TrialError(400, "Enter a name.");
	const name = normalizeProfileName(input.name);
	const problem = profileNameProblem(name, profiles);
	if (problem) throw new TrialError(400, problem);
	if (!isProfileColor(input.color)) throw new TrialError(400, "Pick a color.");
	const color: ProfileColor = input.color;
	let pin: string | undefined;
	if (input.pin !== undefined && input.pin !== null && input.pin !== "") {
		if (!isValidPin(input.pin)) throw new TrialError(400, "A PIN is 4 to 8 digits.");
		pin = input.pin;
	}
	const language: AppLanguage | undefined = isAppLanguage(input.language) ? input.language : undefined;
	const profile: Profile = {
		id: mintUserId(),
		name,
		color,
		role: "member",
		trial: true,
		...(pin ? { pin } : {}),
		createdAt: new Date().toISOString(),
	};
	fs.mkdirSync(userDataDir(profile.id), { recursive: true });
	writeProfiles([...profiles, profile]);
	writeTrialRecord({ version: 1, profileId: profile.id, redeemedAt: new Date().toISOString() });
	runAsUser(profile.id, () => {
		writeSettings({
			version: 1,
			...(language ? { general: { language } } : {}),
			models: {
				strong: { model: { ...TRIAL_DEEPSEEK_MODEL } },
				cheap: { model: { ...TRIAL_DEEPSEEK_MODEL } },
				vision: { model: { ...TRIAL_DEEPSEEK_MODEL } },
			},
		});
	});
	const caller = requestProfile(req);
	return { profileId: profile.id, sessionId: caller ? null : createSession(profile.id) };
}

export function startSolSession(req: Request | undefined): { chatId: string } {
	const profile = requestProfile(req);
	if (!profile) throw new TrialError(401, "Choose a profile first.");
	const record = participantRecord(profile.id);
	if (record.solEndedAt && !record.signedUpAt) {
		throw new TrialError(403, SIGNUP_REQUIRED_MESSAGE, TRIAL_SIGNUP_REQUIRED);
	}
	if (record.solChatId) {
		if (record.solEndedAt) throw new TrialError(409, "The GPT-Sol session is already over.");
		return { chatId: record.solChatId };
	}
	const chatId = runAsUser(profile.id, () => {
		const chat = chatStore.createChat("GPT-Sol");
		chatStore.saveSettings(chat.id, { model: { provider: TRIAL_SOL_MODEL.provider, id: TRIAL_SOL_MODEL.id } });
		return chat.id;
	});
	writeTrialRecord({ ...readTrialRecord(), solChatId: chatId });
	return { chatId };
}

export function endSolSession(req: Request | undefined): void {
	const profile = requestProfile(req);
	if (!profile) throw new TrialError(401, "Choose a profile first.");
	const record = participantRecord(profile.id);
	if (!record.solChatId) throw new TrialError(409, "Start the GPT-Sol session first.");
	if (record.solEndedAt) return;
	writeTrialRecord({ ...record, solEndedAt: new Date().toISOString() });
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseSignup(input: { email?: unknown; name?: unknown; password?: unknown }): TrialAccountInput {
	if (typeof input.email !== "string" || !EMAIL.test(input.email.trim())) throw new TrialError(400, "Enter an email address.");
	if (typeof input.name !== "string" || normalizeProfileName(input.name).length === 0) throw new TrialError(400, "Enter a name.");
	if (typeof input.password !== "string" || input.password.length < 8) throw new TrialError(400, "Use at least 8 characters.");
	return { email: input.email.trim(), name: normalizeProfileName(input.name), password: input.password };
}

async function createTrialAccount(input: TrialAccountInput): Promise<{ id: string }> {
	const { getPayload } = await import("payload");
	const { default: config } = await import("../../payload.config.ts");
	const payload = await getPayload({ config });
	const betterAuth = (payload as {
		betterAuth?: {
			api: {
				createUser: (args: { body: Record<string, unknown> }) => Promise<{ user?: { id?: string | null } }>;
			};
		};
	}).betterAuth;
	if (!betterAuth) throw new TrialError(503, "Accounts are unavailable until the database is running.");
	const result = await betterAuth.api.createUser({
		body: {
			data: { emailVerified: true },
			email: input.email,
			name: input.name,
			password: input.password,
			role: ["user"],
		},
	});
	if (!result.user?.id) throw new TrialError(503, "The account was not created.");
	return { id: String(result.user.id) };
}

let accountCreator: TrialAccountCreator = createTrialAccount;

/** Tests replace the Payload call. Production uses Better Auth's admin create, which does not open public signup. */
export function configureTrialAccountCreator(creator: TrialAccountCreator): void {
	accountCreator = creator;
}

export function resetTrialAccountCreator(): void {
	accountCreator = createTrialAccount;
}

export async function signUpFromTrial(
	req: Request | undefined,
	input: { email?: unknown; name?: unknown; password?: unknown },
): Promise<{ accountId: string }> {
	const profile = requestProfile(req);
	if (!profile) throw new TrialError(401, "Choose a profile first.");
	const record = participantRecord(profile.id);
	if (!record.solEndedAt) throw new TrialError(409, "Finish the GPT-Sol session before signing up.");
	if (record.signedUpAt) throw new TrialError(409, "This trial already has an account.");
	const account = parseSignup(input);
	let created: { id: string };
	try {
		created = await accountCreator(account);
	} catch (err) {
		if (err instanceof TrialError) throw err;
		const message = err instanceof Error ? err.message : "";
		if (/already|exists|duplicate/i.test(message)) throw new TrialError(409, "That email is already an account.");
		throw new TrialError(503, "The account could not be created.");
	}
	const latest = readTrialRecord();
	if (latest.signedUpAt) return { accountId: latest.accountId ?? created.id };
	writeTrialRecord({ ...latest, accountId: created.id, signedUpAt: new Date().toISOString() });
	return { accountId: created.id };
}

export function trialErrorResponse(err: unknown): Response {
	if (err instanceof TrialError) {
		return Response.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
	}
	if (err instanceof UsersError) return Response.json({ error: err.message }, { status: err.status });
	throw err;
}
