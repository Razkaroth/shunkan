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
import { subscriptionRequestOrigin } from "./web-subscription-http.ts";
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
const MIN_INVITE_CODE_LENGTH = 8;
const SIGNUP_PENDING_MS = 2 * 60 * 1000;

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
	const message = trialSignupMessage();
	if (!message) return null;
	return Response.json({ error: message, code: TRIAL_SIGNUP_REQUIRED }, { status: 403 });
}

/** The signup wall text, or null when this caller may keep going. */
export function trialSignupMessage(): string | null {
	const status = trialStatusFor(activeUserId() ?? null);
	return status.signupRequired ? SIGNUP_REQUIRED_MESSAGE : null;
}

/** Browser mutations must be same-origin. Desktop mode is already gated by the proxy. */
export function trialBrowserAllowed(req: Request): boolean {
	const desktop = process.env.LH_DESKTOP_SERVER === "1" || Boolean(process.env.LH_DESKTOP_API_SECRET);
	if (desktop) return true;
	const origin = req.headers.get("origin");
	if (!origin || origin === "null") return false;
	try {
		return origin === subscriptionRequestOrigin(req)
			&& (!req.headers.has("sec-fetch-site") || req.headers.get("sec-fetch-site") === "same-origin");
	} catch {
		return false;
	}
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
	if (expected.length < MIN_INVITE_CODE_LENGTH) {
		throw new TrialError(503, `TRIAL_INVITE_CODE must be at least ${MIN_INVITE_CODE_LENGTH} characters.`);
	}
	if (typeof input.code !== "string" || input.code.trim() === "") throw new TrialError(400, "Enter the invite code.");
	if (!codesMatch(input.code.trim(), expected)) throw new TrialError(403, "That code does not match.");
	const profiles = readProfiles();
	if (readTrialRecord().profileId || profiles.some((profile) => profile.trial)) {
		throw new TrialError(409, "This trial code is already redeemed.");
	}
	if (hasUnclaimedData()) {
		throw new TrialError(409, "The owner needs to open the app once before this code can be redeemed.");
	}
	if (profiles.length === 0) {
		throw new TrialError(409, "Create the owner profile before redeeming this code.");
	}
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

async function payloadClient() {
	const { getPayload } = await import("payload");
	const { default: config } = await import("../../payload.config.ts");
	return getPayload({ config });
}

/** Same lookup the Discord super-admin seed uses. Only for recovering a create that already landed. */
async function findAccountIdByEmail(email: string): Promise<string | null> {
	const payload = await payloadClient();
	const { docs } = await payload.find({
		collection: "users",
		depth: 0,
		limit: 1,
		overrideAccess: true,
		where: { email: { equals: email } },
	});
	const id = docs[0]?.id;
	return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

async function createTrialAccount(input: TrialAccountInput): Promise<{ id: string }> {
	const payload = await payloadClient();
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
	const pending = readTrialRecord();
	if (pending.signupPendingAt && !pending.signedUpAt) {
		const recovered = await findAccountIdByEmail(account.email).catch(() => null);
		if (recovered) return linkTrialAccount(recovered);
		const age = Date.now() - Date.parse(pending.signupPendingAt);
		if (Number.isFinite(age) && age < SIGNUP_PENDING_MS) {
			throw new TrialError(409, "Signup is already in progress.");
		}
	}
	writeTrialRecord({ ...readTrialRecord(), signupPendingAt: new Date().toISOString() });
	let created: { id: string };
	try {
		created = await accountCreator(account);
	} catch (err) {
		if (err instanceof TrialError) {
			clearSignupPending();
			throw err;
		}
		const message = err instanceof Error ? err.message : "";
		if (/already|exists|duplicate/i.test(message)) {
			const recovered = await findAccountIdByEmail(account.email).catch(() => null);
			if (recovered) return linkTrialAccount(recovered);
			clearSignupPending();
			throw new TrialError(409, "That email is already an account.");
		}
		clearSignupPending();
		throw new TrialError(503, "The account could not be created.");
	}
	return linkTrialAccount(created.id);
}

function linkTrialAccount(accountId: string): { accountId: string } {
	const latest = readTrialRecord();
	if (latest.signedUpAt) return { accountId: latest.accountId ?? accountId };
	const { signupPendingAt: _pending, ...rest } = latest;
	writeTrialRecord({ ...rest, accountId, signedUpAt: new Date().toISOString() });
	return { accountId };
}

function clearSignupPending(): void {
	const latest = readTrialRecord();
	if (!latest.signupPendingAt || latest.signedUpAt) return;
	const { signupPendingAt: _pending, ...rest } = latest;
	writeTrialRecord(rest);
}

export function trialErrorResponse(err: unknown): Response {
	if (err instanceof TrialError) {
		return Response.json({ error: err.message, ...(err.code ? { code: err.code } : {}) }, { status: err.status });
	}
	if (err instanceof UsersError) return Response.json({ error: err.message }, { status: err.status });
	throw err;
}
