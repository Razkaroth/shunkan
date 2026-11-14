import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { removeLeftoverTemps, writeFileAtomicSync } from "../src/persistence/atomic-write.ts";

describe("writeFileAtomicSync", () => {
	it("replaces a file with the complete new bytes and keeps mode 0o600", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lh-atomic-"));
		const file = path.join(dir, "record.json");
		fs.writeFileSync(file, "old");
		writeFileAtomicSync(file, '{"ok":true}', { mode: 0o600 });
		assert.equal(fs.readFileSync(file, "utf8"), '{"ok":true}');
		assert.equal(fs.statSync(file).mode & 0o777, 0o600);
		fs.writeFileSync(`${file}.tmp-leftover`, "stale");
		fs.unlinkSync(file);
		removeLeftoverTemps(file);
		assert.equal(fs.existsSync(`${file}.tmp-leftover`), false);
	});
});
