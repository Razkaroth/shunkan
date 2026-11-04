/**
 * University trial pins. The ids are Vercel AI Gateway catalog ids
 * (`creator/model`), the same strings the gateway and the pi-ai
 * vercel-ai-gateway catalog publish:
 *   deepseek/deepseek-v4.1-flash  — DeepSeek V4.1 Flash
 *   openai/gpt-6.1-sol            — GPT-6.1 Sol
 * Nothing here prices either model. The gateway bills the call.
 */

/** Main agent (strong: prober and teacher) and both support tiers
 *  (cheap: researcher, demo, extractor, auditor; vision: visual maker
 *  and pdf reader) use this model for the trial. */
export const TRIAL_DEEPSEEK_MODEL = {
	provider: "vercel-ai-gateway",
	id: "deepseek/deepseek-v4.1-flash",
} as const;

/** The one GPT-Sol session. Not a price and not a second DeepSeek pin. */
export const TRIAL_SOL_MODEL = {
	provider: "vercel-ai-gateway",
	id: "openai/gpt-6.1-sol",
} as const;

export const TRIAL_SIGNUP_REQUIRED = "trial_signup_required" as const;

/** Install-wide trial bookkeeping. The invite code itself is never stored. */
export interface TrialRecord {
	version: 1;
	profileId?: string;
	redeemedAt?: string;
	/** The single GPT-Sol chat. Absent until the friend starts it. */
	solChatId?: string;
	/** Set when that chat's first reply lands, or when the friend ends it. */
	solEndedAt?: string;
	/** Better Auth user id from the trial signup. Not a billing customer. */
	accountId?: string;
	signedUpAt?: string;
	/** Set while the one account is being created. Cleared on success or failure. */
	signupPendingAt?: string;
}

export const EMPTY_TRIAL: TrialRecord = { version: 1 };

/** What the browser can see. No code, no account id. */
export interface TrialPublicStatus {
	/** A code is configured and nobody has redeemed it. */
	open: boolean;
	/** The signed-in profile is the friend who redeemed it. */
	participant: boolean;
	solChatId: string | null;
	/** The GPT-Sol chat exists and has not ended. */
	solOpen: boolean;
	/** The Sol session is over and this friend has not signed up. */
	signupRequired: boolean;
	signedUp: boolean;
}

export function trialPublicStatus(input: {
	codeConfigured: boolean;
	record: TrialRecord;
	profileId: string | null;
}): TrialPublicStatus {
	const participant = !!input.profileId && input.profileId === input.record.profileId;
	const solChatId = participant ? (input.record.solChatId ?? null) : null;
	const ended = participant && !!input.record.solEndedAt;
	const signedUp = participant && !!input.record.signedUpAt;
	return {
		open: input.codeConfigured && !input.record.profileId,
		participant,
		solChatId,
		solOpen: !!solChatId && !ended,
		signupRequired: ended && !signedUp,
		signedUp,
	};
}

/** The conversation model for a trial friend. The open Sol chat is the
 *  one exception; every other chat stays on DeepSeek. */
export function trialConversationModel(
	record: TrialRecord,
	profileId: string | undefined,
	chatId: string,
): { provider: string; id: string } | undefined {
	if (!profileId || record.profileId !== profileId) return undefined;
	if (record.solChatId === chatId && !record.solEndedAt) return { ...TRIAL_SOL_MODEL };
	return { ...TRIAL_DEEPSEEK_MODEL };
}
