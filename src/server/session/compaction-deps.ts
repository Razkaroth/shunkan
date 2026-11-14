import { composeInstructions } from "../../agent/teacher-agent.ts";
import { piEngineForSpec, type PiEngine } from "../../agent/models.ts";
import { connectionBackgroundAllowed as subscriptionBackgroundAllowed } from "../../agent/subscription-connections.ts";
import { CLAUDE_CODE_PROVIDER } from "../../core/contracts/claude-code.ts";
import { hasProbeDone } from "../../core/native-messages.ts";
import { resolveConversationSpec } from "../../core/settings-resolution.ts";
import { providerKeyPresent } from "../keys.ts";
import { catalogContextLimits } from "../model-catalog.ts";
import { effectiveThresholdTokens, type CompactionDeps } from "../compaction.ts";
import { effectiveSettings, stores } from "../stores.ts";
import { trialMainModel } from "../trial.ts";

function backgroundAllowed(provider: string): boolean {
	return subscriptionBackgroundAllowed(provider) && (provider !== CLAUDE_CODE_PROVIDER || providerKeyPresent(provider));
}

/** The settle-kick's compaction inputs, read fresh. Null when there is nothing to run. */
export function compactionDeps(chatId: string): CompactionDeps | null {
	const fresh = effectiveSettings();
	const record = stores.chatStore.getChat(chatId);
	if (!record) return null;
	const saved = resolveConversationSpec(record.settings, fresh.models.strong);
	const forced = trialMainModel(chatId);
	const spec = forced ? { provider: forced.provider, id: forced.id, thinkingLevel: saved?.thinkingLevel } : saved;
	if (!spec || !backgroundAllowed(spec.provider)) return null;
	let engine: PiEngine;
	try {
		engine = piEngineForSpec(spec, true, undefined, () => stores.settingsStore.readSettings()?.models?.strong?.cacheRetention);
	} catch {
		return null;
	}
	const modelId = `${engine.model.provider}:${engine.model.id}`;
	return {
		chatStore: stores.chatStore,
		engine,
		canStart: () => backgroundAllowed(spec.provider),
		modelId,
		kind: record.kind === "practice" ? "practice" : hasProbeDone(record.messages) ? "teach" : "probe",
		thresholdTokens: effectiveThresholdTokens(fresh.compaction?.thresholdTokens, catalogContextLimits().get(modelId)),
		includeReasoning: fresh.compaction?.includeReasoning === true,
		systemPromptTokens: Math.ceil(composeInstructions(record.kind === "practice" ? "practice" : "teacher", undefined, fresh.general.language).length / 4),
		language: fresh.general.language,
	};
}
