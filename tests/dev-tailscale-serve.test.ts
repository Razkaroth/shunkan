import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
	offCommand,
	offSlots,
	serveCommand,
	serveSlots,
	shouldServeTailscale,
} from "../devenv/dev-tailscale-serve.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function runDev(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn("bash", ["devenv/dev.sh", ...args], { cwd: root });
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk;
		});
		child.on("error", reject);
		child.on("close", (code) => {
			resolve({ code: code ?? 1, stdout, stderr });
		});
	});
}

describe("tailscale preview commands", () => {
	test("serves a tailnet host only when https and tailscale are available", () => {
		assert.equal(
			shouldServeTailscale({
				tailscaleOnPath: true,
				host: "serenity.drum-justitia.ts.net",
				scheme: "https",
			}),
			true,
		);
		assert.equal(
			shouldServeTailscale({
				tailscaleOnPath: false,
				host: "serenity.drum-justitia.ts.net",
				scheme: "https",
			}),
			false,
		);
		assert.equal(shouldServeTailscale({ tailscaleOnPath: true, host: "serenity", scheme: "http" }), false);
		assert.equal(
			shouldServeTailscale({
				tailscaleOnPath: true,
				host: "serenity.drum-justitia.ts.net",
				scheme: "http",
			}),
			false,
		);
	});

	test("maps each local port to the same https port", () => {
		assert.deepEqual(serveCommand(3009), ["serve", "--bg", "--https=3009", "3009"]);
		assert.deepEqual(offCommand(3009), ["serve", "--https=3009", "3009", "off"]);
		assert.deepEqual(serveSlots([3009, 9009]), [
			["serve", "--bg", "--https=3009", "3009"],
			["serve", "--bg", "--https=9009", "9009"],
		]);
		assert.deepEqual(offSlots([3009, 9009]), [
			["serve", "--https=3009", "3009", "off"],
			["serve", "--https=9009", "9009", "off"],
		]);
	});

	test("public preview uses funnel for every port", () => {
		assert.deepEqual(serveCommand(3009, { public: true }), ["funnel", "--bg", "--https=3009", "3009"]);
		assert.deepEqual(offCommand(3009, { public: true }), ["funnel", "--https=3009", "3009", "off"]);
		assert.deepEqual(serveSlots([3009, 9009], { public: true }), [
			["funnel", "--bg", "--https=3009", "3009"],
			["funnel", "--bg", "--https=9009", "9009"],
		]);
	});
});

describe("dev help", () => {
	test("names start, serve, and the npm tasks without starting a server", async () => {
		const serve = await runDev(["serve", "--help"]);
		assert.equal(serve.code, 0);
		assert.equal(serve.stderr, "");
		assert.match(serve.stdout, /--public/);
		assert.match(serve.stdout, /tailscale serve/);
		assert.match(serve.stdout, /tailscale funnel/);

		const top = await runDev(["--help"]);
		assert.equal(top.code, 0);
		assert.equal(top.stderr, "");
		assert.match(top.stdout, /dev start \[--quiet\]/);
		assert.match(top.stdout, /dev serve \[--public\]/);
		assert.match(top.stdout, /dev seed/);
		assert.match(top.stdout, /lint \| typecheck \| test \| build/);
		assert.doesNotMatch(top.stdout, /3003/);
	});
});
