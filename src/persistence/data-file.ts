/**
 * The durable-file seam. Store adapters keep calling read/write/rename.
 * Hosted runs send those bytes to the learner-records collection.
 * Tests (NODE_ENV=test) and LH_STORE=file keep the throwaway directory.
 * LH_STORE=database forces Mongo even under the test runner.
 * Debug traces and anything outside the data root or auth directory stay on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { removeLeftoverTemps, writeFileAtomicSync } from "./atomic-write.ts";
import {
	recordDel,
	recordDelPrefix,
	recordExists,
	recordGet,
	recordList,
	recordMove,
	recordPut,
} from "./mongo-sync.ts";

interface Roots {
	dataRoot: string;
	authFile: string;
}

let roots: Roots | null = null;

export function configureDataFiles(next: { dataRoot: string; authFile: string }): void {
	roots = { dataRoot: path.resolve(next.dataRoot), authFile: path.resolve(next.authFile) };
}

export function usesDatabase(): boolean {
	if (process.env.LH_STORE === "file") return false;
	if (process.env.LH_STORE === "database") return true;
	if (process.env.NODE_ENV === "test") return false;
	return Boolean(process.env.MONGODB_URI);
}

export function authDirectory(): string {
	if (!roots) throw new Error("Durable storage is not configured");
	return path.dirname(roots.authFile);
}

function requireRoots(): Roots {
	if (!roots) throw new Error("Durable storage is not configured");
	return roots;
}

function authRecordName(abs: string, authFile: string): string | null {
	if (path.dirname(abs) !== path.dirname(authFile)) return null;
	const base = path.basename(abs);
	if (abs === authFile) return "auth.json";
	if (base.startsWith(".auth.json.tmp-")) return base;
	if (base === "chatgpt-credentials.json" || base === "github-copilot-credentials.json" || base === "xai-credentials.json") return base;
	if (/^(chatgpt-credentials|github-copilot-credentials|xai-credentials)\.json\..+\.tmp$/.test(base)) return base;
	return null;
}

/** A file under the product data root. Hosted runs persist it through learner-records. */
export function productPath(...parts: string[]): string {
	const root = requireRoots().dataRoot;
	if (parts.length === 0 || parts.some((part) => !part || part === "." || part === ".." || part.includes("/") || part.includes("\\"))) {
		throw new Error("invalid data path");
	}
	return path.join(root, ...parts);
}

/** Relative record path, or null when this path is not durable product data. */
export function logicalKey(file: string): string | null {
	if (!usesDatabase()) return null;
	const configured = requireRoots();
	const abs = path.resolve(file);
	const authName = authRecordName(abs, configured.authFile);
	if (authName) return `install/${authName}`;
	const root = configured.dataRoot;
	if (abs !== root && !abs.startsWith(`${root}${path.sep}`)) return null;
	const rel = path.relative(root, abs);
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
	const portable = rel.split(path.sep).join("/");
	if (portable === "debug" || portable.startsWith("debug/") || portable.includes("/debug/") || portable.endsWith("/debug")) return null;
	return portable;
}

function kindFor(key: string): string {
	if (key === "install/auth.json" || key.startsWith("install/.auth.json.tmp-")) return "keys";
	if (key.startsWith("install/") && key.includes("credentials")) return "subscription";
	if (key === "users.json" || key === "host.json" || key === "sessions.json") return "profile";
	if (key === "settings.json" || key.endsWith("/settings.json")) return "settings";
	if (key === "chats" || key.startsWith("chats/") || key.includes("/chats/")) return "chat";
	if (key === "jobs" || key.startsWith("jobs/") || key.includes("/jobs/")) return "job";
	if (key === "prompts" || key.startsWith("prompts/") || key.includes("/prompts/")) return "prompt";
	if (key === "graph" || key.startsWith("graph/") || key.includes("/graph/")) return "graph";
	return "record";
}

function missing(file: string): NodeJS.ErrnoException {
	return Object.assign(new Error(`ENOENT: no such file or directory, open '${file}'`), {
		code: "ENOENT",
		errno: -2,
		syscall: "open",
		path: file,
	});
}

function textOf(data: string | NodeJS.ArrayBufferView): string {
	return typeof data === "string" ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
}

export function existsSync(file: string): boolean {
	const key = logicalKey(file);
	if (key) return recordExists(key);
	return fs.existsSync(file);
}

export function readFileSync(file: string, encoding?: BufferEncoding): string {
	const key = logicalKey(file);
	if (key) {
		const doc = recordGet(key);
		if (!doc) throw missing(file);
		return doc.body;
	}
	return fs.readFileSync(file, encoding ?? "utf8");
}

function atomicMode(options?: fs.WriteFileOptions): { mode?: number } | undefined {
	if (!options || typeof options === "string" || typeof options.mode !== "number") return undefined;
	return { mode: options.mode };
}

export function writeFileSync(file: string, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions): void {
	const key = logicalKey(file);
	if (key) {
		recordPut(key, textOf(data), kindFor(key));
		return;
	}
	const bytes = typeof data === "string" ? data : Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	writeFileAtomicSync(file, bytes, atomicMode(options));
}

export function appendFileSync(file: string, data: string, encoding?: BufferEncoding): void {
	const key = logicalKey(file);
	if (key) {
		const prev = recordGet(key)?.body ?? "";
		recordPut(key, prev + data, kindFor(key));
		return;
	}
	fs.appendFileSync(file, data, encoding);
}

export function mkdirSync(dir: string, options?: fs.MakeDirectoryOptions): void {
	if (logicalKey(dir)) return;
	fs.mkdirSync(dir, options);
}

export function readdirSync(dir: string, options: { withFileTypes: true }): StoredDirent[];
export function readdirSync(dir: string, options?: { withFileTypes?: false }): string[];
export function readdirSync(dir: string, options?: { withFileTypes?: boolean }): string[] | StoredDirent[] {
	const key = logicalKey(dir);
	if (key) {
		const entries = recordList(key).map((entry) => new StoredDirent(entry.name, entry.dir ? "dir" : "file"));
		return options?.withFileTypes ? entries : entries.map((entry) => entry.name);
	}
	if (options?.withFileTypes) return fs.readdirSync(dir, { withFileTypes: true }) as unknown as StoredDirent[];
	return fs.readdirSync(dir);
}

export function renameSync(from: string, to: string): void {
	const fromKey = logicalKey(from);
	const toKey = logicalKey(to);
	if (fromKey && toKey) {
		const moved = recordMove(fromKey, toKey);
		if (fs.existsSync(from)) fs.renameSync(from, to);
		else if (moved === 0) throw missing(from);
		return;
	}
	fs.renameSync(from, to);
}

export function unlinkSync(file: string): void {
	const key = logicalKey(file);
	if (key) {
		if (recordDel(key) === 0) throw missing(file);
		return;
	}
	fs.unlinkSync(file);
	removeLeftoverTemps(file);
}

export function rmSync(target: string, options?: fs.RmOptions): void {
	const key = logicalKey(target);
	if (key) {
		const removed = options?.recursive ? recordDelPrefix(key) : recordDel(key);
		const onDisk = fs.existsSync(target);
		if (onDisk) fs.rmSync(target, { ...options, force: true });
		if (removed === 0 && !onDisk && !options?.force) throw missing(target);
		return;
	}
	fs.rmSync(target, options);
	if (!options?.recursive) removeLeftoverTemps(target);
}

export function chmodSync(file: string, mode: fs.Mode): void {
	if (logicalKey(file)) return;
	fs.chmodSync(file, mode);
}

export function statSync(file: string): fs.Stats {
	const key = logicalKey(file);
	if (key) {
		const doc = recordGet(key);
		if (!doc) throw missing(file);
		return {
			mtimeMs: doc.updatedAt,
			size: Buffer.byteLength(doc.body),
			mode: 0o600,
			isFile: () => true,
			isDirectory: () => false,
		} as fs.Stats;
	}
	return fs.statSync(file);
}

export class StoredDirent {
	constructor(
		public name: string,
		private kind: "file" | "dir",
	) {}
	isDirectory(): boolean {
		return this.kind === "dir";
	}
	isFile(): boolean {
		return this.kind === "file";
	}
	isSymbolicLink(): boolean {
		return false;
	}
}
