import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isPublicAddress } from "../src/agent/tools/safe-fetch.ts";

describe("isPublicAddress", () => {
	it("accepts public addresses and refuses loopback, private networks, and metadata", () => {
		assert.equal(isPublicAddress("8.8.8.8"), true);
		assert.equal(isPublicAddress("1.1.1.1"), true);
		assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
		assert.equal(isPublicAddress("127.0.0.1"), false);
		assert.equal(isPublicAddress("10.1.2.3"), false);
		assert.equal(isPublicAddress("192.168.1.1"), false);
		assert.equal(isPublicAddress("172.16.0.1"), false);
		assert.equal(isPublicAddress("169.254.169.254"), false);
		assert.equal(isPublicAddress("::1"), false);
		assert.equal(isPublicAddress("::ffff:127.0.0.1"), false);
		assert.equal(isPublicAddress("::ffff:8.8.8.8"), true);
		assert.equal(isPublicAddress("not-an-ip"), false);
	});
});
