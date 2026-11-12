/**
 * Hosted records live in Mongo, not the data directory.
 * Skips when nothing is listening on MONGODB_URI.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-db-persist-"));
const dbName = `shunkan_persist_${process.pid}`;
const uri = process.env.SHUNKAN_TEST_MONGO ?? `mongodb://127.0.0.1:27417/${dbName}`;
process.env = {
	...process.env,
	LH_STORE: "database",
	LH_DATA_DIR: directory,
	LH_AUTH_FILE: path.join(directory, "auth.json"),
	MONGODB_URI: uri,
	NODE_ENV: "test",
};

const { MongoClient } = createRequire(path.join(process.cwd(), "node_modules/mongoose/package.json"))("mongodb") as {
	MongoClient: new (uri: string, options?: { serverSelectionTimeoutMS?: number }) => {
		connect(): Promise<void>;
		close(): Promise<void>;
		db(): { dropDatabase(): Promise<void> };
	};
};

let mongo = false;
try {
	const probe = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
	await probe.connect();
	await probe.close();
	mongo = true;
} catch {
	mongo = false;
}

describe("learner records in Mongo", { skip: mongo ? false : "MongoDB is not listening for SHUNKAN_TEST_MONGO" }, () => {
	after(async () => {
		if (!mongo) return;
		const { resetRecordStoreForTests } = await import("../src/persistence/mongo-sync.ts");
		resetRecordStoreForTests();
		const client = new MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
		await client.connect();
		await client.db().dropDatabase();
		await client.close();
		fs.rmSync(directory, { recursive: true, force: true });
	});

	it("writes chats, jobs, settings, keys, graph, prompts, and profiles without files", async () => {
		const { chatStore } = await import("../src/store/chats.ts");
		const { jobStore } = await import("../src/store/jobs.ts");
		const { readSettings, writeSettings } = await import("../src/store/settings.ts");
		const { authStore } = await import("../src/store/auth.ts");
		const { graphStore } = await import("../src/store/graph.ts");
		const { promptOverrides } = await import("../src/store/prompt-overrides.ts");
		const { readPromptOverride } = await import("../src/agent/prompt-segments.ts");
		const { registryExists, writeProfiles } = await import("../src/store/users.ts");
		const { graphRevision } = await import("../src/server/graph.ts");
		const { readFileSync, writeFileSync } = await import("../src/persistence/data-file.ts");

		const chat = chatStore.createChat("Database session");
		assert.equal(chatStore.getChat(chat.id)?.title, "Database session");

		const job = jobStore.createJob({ kind: "research", chatId: chat.id, toolCallId: "tool_db" });
		assert.equal(jobStore.getJob(job.id)?.chatId, chat.id);

		writeSettings({ version: 1, graph: { enabled: false } });
		assert.equal(readSettings()?.graph?.enabled, false);

		authStore.setAuthVar("OPENROUTER_API_KEY", "sk-or-v1-db");
		assert.equal(authStore.authVars().OPENROUTER_API_KEY, "sk-or-v1-db");

		graphStore.writePositions({ node_a: { x: 3, y: 4 } });
		assert.deepEqual(graphStore.readPositions(), { node_a: { x: 3, y: 4 } });
		assert.ok(graphRevision() > 0);

		promptOverrides.writeOverride("system-prompt.md", "database override\n");
		assert.equal(readPromptOverride("system-prompt.md"), "database override\n");
		assert.deepEqual(promptOverrides.listOverrides(), ["system-prompt.md"]);

		writeProfiles([
			{ id: "usr_dbtest01", name: "Ada", color: "violet", role: "admin", createdAt: "2026-11-03T00:00:00.000Z" },
		]);
		assert.equal(registryExists(), true);

		const credentials = path.join(directory, "chatgpt-credentials.json");
		writeFileSync(credentials, "{\"version\":1}\n");
		assert.equal(readFileSync(credentials, "utf8"), "{\"version\":1}\n");

		assert.deepEqual(fs.readdirSync(directory), [], "durable records did not create data files");
	});
});
