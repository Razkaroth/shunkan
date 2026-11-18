/**
 * Admin allowlist from the Payload `plugins` global, and the household's
 * own toggles. A signed-in user can turn on only a plugin the admin checked.
 */
import crypto from "node:crypto";
import path from "node:path";
import { INSTALL } from "../../config.ts";
import {
	PLUGINS_OFF,
	isPluginId,
	pluginsFromChoices,
	pluginsFromGlobal,
	resolvedPlugins,
	type PluginFlags,
	type PluginId,
} from "../core/plugins.ts";
import * as fs from "../persistence/data-file.ts";
import { requestAccountId } from "./account.ts";
import { requestProfile, UsersError } from "./users.ts";

const CHOICES = () => path.join(INSTALL.root, "plugin-choices.json");
const ALLOW_TTL_MS = 5_000;
let allowCache: { at: number; value: PluginFlags } | null = null;
let allowReader: () => Promise<PluginFlags> = readAllowlistGlobal;

export function clearPluginAllowlistCache(): void {
	allowCache = null;
}

/** Tests replace the Payload read. Production reads the global. */
export function configurePluginAllowlist(reader: () => Promise<PluginFlags>): void {
	allowReader = reader;
	allowCache = null;
}

export function resetPluginAllowlist(): void {
	allowReader = readAllowlistGlobal;
	allowCache = null;
}

export async function pluginAllowlist(now = Date.now()): Promise<PluginFlags> {
	if (allowCache && now - allowCache.at < ALLOW_TTL_MS) return allowCache.value;
	const value = await allowReader();
	allowCache = { at: now, value };
	return value;
}

async function readAllowlistGlobal(): Promise<PluginFlags> {
	try {
		const { getPayload } = await import("payload");
		const { default: config } = await import("../../payload.config.ts");
		const payload = await getPayload({ config });
		const global = await payload.findGlobal({ slug: "plugins", overrideAccess: true });
		return pluginsFromGlobal(global);
	} catch (err) {
		console.warn("plugins global could not be read; every plugin stays off", err instanceof Error ? err.message : err);
		return PLUGINS_OFF;
	}
}

function readChoices(): Record<string, PluginFlags> {
	try {
		const raw = JSON.parse(fs.readFileSync(CHOICES(), "utf-8")) as { choices?: unknown };
		if (!raw.choices || typeof raw.choices !== "object" || Array.isArray(raw.choices)) return {};
		const out: Record<string, PluginFlags> = {};
		for (const [ownerId, value] of Object.entries(raw.choices as Record<string, unknown>)) {
			out[ownerId] = pluginsFromChoices(value);
		}
		return out;
	} catch {
		return {};
	}
}

function writeChoices(choices: Record<string, PluginFlags>): void {
	fs.mkdirSync(path.dirname(CHOICES()), { recursive: true });
	const tmp = `${CHOICES()}.tmp-${crypto.randomUUID().slice(0, 8)}`;
	fs.writeFileSync(tmp, `${JSON.stringify({ version: 1, choices }, null, "\t")}\n`, "utf-8");
	fs.renameSync(tmp, CHOICES());
}

export function householdPlugins(ownerId: string): PluginFlags {
	return readChoices()[ownerId] ?? PLUGINS_OFF;
}

export async function pluginsForOwner(ownerId: string): Promise<{ allowed: PluginFlags; enabled: PluginFlags }> {
	const allowed = await pluginAllowlist();
	const chosen = householdPlugins(ownerId);
	return { allowed, enabled: resolvedPlugins(allowed, chosen) };
}

export async function setHouseholdPlugin(ownerId: string, id: PluginId, enabled: boolean): Promise<PluginFlags> {
	const allowed = await pluginAllowlist();
	if (enabled && !allowed[id]) throw new UsersError(403, "That plugin is not available.");
	const choices = readChoices();
	const next = { ...(choices[ownerId] ?? PLUGINS_OFF), [id]: enabled };
	choices[ownerId] = next;
	writeChoices(choices);
	return resolvedPlugins(allowed, next);
}

export async function pluginsResponse(req: Request): Promise<Response> {
	const profile = requestProfile(req);
	if (!profile?.ownerId) return Response.json({ allowed: PLUGINS_OFF, enabled: PLUGINS_OFF });
	return Response.json(await pluginsForOwner(profile.ownerId));
}

export async function setPluginResponse(req: Request, body: { plugin?: unknown; enabled?: unknown }): Promise<Response> {
	const accountId = await requestAccountId(req);
	const profile = requestProfile(req);
	if (!accountId || !profile) throw new UsersError(401, "Sign in first.");
	if (profile.ownerId !== accountId) throw new UsersError(403, "That profile belongs to another account.");
	if (!isPluginId(body.plugin) || typeof body.enabled !== "boolean") {
		throw new UsersError(400, "Name a shipped plugin and whether it is on.");
	}
	const enabled = await setHouseholdPlugin(accountId, body.plugin, body.enabled);
	return Response.json({ allowed: await pluginAllowlist(), enabled });
}

export async function pluginEnabled(ownerId: string | undefined, id: PluginId): Promise<boolean> {
	if (!ownerId) return false;
	return (await pluginsForOwner(ownerId)).enabled[id];
}
