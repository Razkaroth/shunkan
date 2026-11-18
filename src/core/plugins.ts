/** The three plugins this install ships. Each checkbox defaults off. */
export const PLUGIN_IDS = ["flashcards", "drawingPad", "richCodeBlocks"] as const;

/** The settings screen publishes the household's saved flags on this event. */
export const PLUGINS_CHANGED_EVENT = "shunkan-plugins";

export type PluginId = (typeof PLUGIN_IDS)[number];

export type PluginFlags = Record<PluginId, boolean>;

export const PLUGINS_OFF: PluginFlags = {
	flashcards: false,
	drawingPad: false,
	richCodeBlocks: false,
};

export function isPluginId(value: unknown): value is PluginId {
	return typeof value === "string" && (PLUGIN_IDS as readonly string[]).includes(value);
}

/** True only for an explicit true. A missing global or any other value stays off. */
export function pluginsFromGlobal(raw: unknown): PluginFlags {
	const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
	return {
		flashcards: record.flashcards === true,
		drawingPad: record.drawingPad === true,
		richCodeBlocks: record.richCodeBlocks === true,
	};
}

export function pluginsFromChoices(raw: unknown): PluginFlags {
	return pluginsFromGlobal(raw);
}

/** A household can enable a plugin only when the admin checkbox is on. */
export function resolvedPlugins(allowed: PluginFlags, chosen: PluginFlags): PluginFlags {
	return {
		flashcards: allowed.flashcards && chosen.flashcards,
		drawingPad: allowed.drawingPad && chosen.drawingPad,
		richCodeBlocks: allowed.richCodeBlocks && chosen.richCodeBlocks,
	};
}
