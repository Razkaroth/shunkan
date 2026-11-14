import { IMPORT_EXTENSIONS, MAX_IMPORT_BYTES, validNotesPath } from "@/lib/notes-import-limits";
import type { Translate } from "@/components/i18n";
import { translate } from "@/src/core";
import type { NotesImportResult } from "./notes-import";

export const notesPath = (file: File): string => file.webkitRelativePath || file.name;
export interface ImportQueueSnapshot {
	importing: boolean;
	errors: string[];
	notices: string[];
	completion: number;
}
export const EMPTY_IMPORT_QUEUE: ImportQueueSnapshot = { importing: false, errors: [], notices: [], completion: 0 };

/** PR198's refill-on-completion, one-request-per-file transport, extended to
 * accept later selections. One instance per page, NOT three workers per click.
 * Only pending/in-flight Files are retained; no retry or persisted upload queue. */
export function createNotesImportQueue(post: (files: readonly File[], t: Translate) => Promise<NotesImportResult[]>) {
	const listeners = new Set<() => void>();
	const pending: { file: File; index: number }[] = [];
	const failures = new Map<number, string>();
	const notices = new Map<number, string>();
	let active = 0, sequence = 0;
	let t: Translate = (key, vars) => translate("en", key, vars);
	let snapshot = EMPTY_IMPORT_QUEUE;
	const ordered = (map: Map<number, string>) => [...map].sort(([a], [b]) => a - b).map(([, text]) => text);
	const publish = (completed = false) => {
		snapshot = { importing: active > 0 || pending.length > 0, errors: ordered(failures), notices: ordered(notices), completion: snapshot.completion + Number(completed) };
		for (const listener of [...listeners]) listener();
	};
	// Normalize a synchronously throwing transport to the same async settlement.
	const send = async (file: File) => post([file], t);
	function pump(): void {
		while (active < 3 && pending.length > 0) {
			const { file, index } = pending.shift()!;
			active++;
			void (async () => {
				try {
					const [r] = await send(file);
					if (!r) throw new Error(t("graph.import.invalidResponse"));
					if (!r.ok) {
						const details = [r.provider, r.missing?.join(", "), r.slots?.join(", ")].filter(Boolean);
						failures.set(index, `${r.filePath}: ${r.error}${r.code ? `\n${[r.code, ...details].join(" — ")}` : ""}`);
					} else if (r.notice) notices.set(index, `${r.filePath}: ${r.notice}`);
				} catch (error) {
					// Never retry an ambiguous response: the merge may have committed.
					failures.set(index, `${notesPath(file)}: ${error instanceof Error ? error.message : String(error)}`);
				} finally {
					active--;
					pump();
					publish(active === 0 && pending.length === 0);
				}
			})();
		}
	}
	return {
		getSnapshot: () => snapshot,
		subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
		/** `translate` is the selecting page's copy; later selections replace it. */
		append(files: readonly File[], translate?: Translate) {
			if (files.length === 0) return;
			if (translate) t = translate;
			if (!snapshot.importing) { failures.clear(); notices.clear(); sequence = 0; }
			const unsupported = new Map<string, number>();
			const unsafe: number[] = [];
			let firstUnsupported = -1;
			let firstUnsafe = -1;
			const extensionLabel = (name: string) => {
				const base = name.split(/[/\\]/).pop() ?? name;
				const dot = base.lastIndexOf(".");
				return dot > 0 ? base.slice(dot).toLowerCase() : t("graph.import.noExtension");
			};
			const hiddenInFolder = (file: File) => file.webkitRelativePath.split("/").slice(1).some((part) => part.startsWith("."));
			for (const file of files) {
				const index = sequence++;
				const path = notesPath(file);
				if (file.webkitRelativePath && hiddenInFolder(file)) continue;
				if (!validNotesPath(path, file.name)) {
					if (firstUnsafe < 0) firstUnsafe = index;
					unsafe.push(index);
				} else if (!IMPORT_EXTENSIONS.test(file.name)) {
					const label = extensionLabel(file.name);
					unsupported.set(label, (unsupported.get(label) ?? 0) + 1);
					if (firstUnsupported < 0) firstUnsupported = index;
				} else if (file.size > MAX_IMPORT_BYTES) failures.set(index, `${path}: ${t("graph.import.tooBig")}`);
				else pending.push({ file, index });
			}
			if (unsupported.size > 0) {
				const count = [...unsupported.values()].reduce((sum, n) => sum + n, 0);
				const types = [...unsupported.keys()].sort().join(", ");
				failures.set(firstUnsupported, t(count === 1 ? "graph.import.skippedType.one" : "graph.import.skippedType.many", { count, types }));
			}
			if (unsafe.length > 0) {
				failures.set(firstUnsafe, t(unsafe.length === 1 ? "graph.import.skippedName.one" : "graph.import.skippedName.many", { count: unsafe.length }));
			}
			const hadWork = active > 0 || pending.length > 0;
			pump();
			publish(!hadWork);
		},
	};
}
