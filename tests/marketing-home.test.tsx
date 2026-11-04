import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingHome, SHUNKAN_SOURCE } from "../components/marketing/home.tsx";

// Empty install, set before the page module loads config, so pageUserId
// sees no profile registry and HomePage takes the unsigned branch.
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), "lh-marketing-"));
process.env.LH_DATA_DIR = DATA;
after(() => fs.rmSync(DATA, { recursive: true, force: true }));

const LICENSE_URL = "https://github.com/Razkaroth/shunkan/blob/Raz-edition/LICENSE";

test("marketing homepage states the hosted product, the license, and the source", () => {
	const html = renderToStaticMarkup(<MarketingHome />);
	assert.match(html, /A moment of learning\./);
	assert.match(html, /瞬間/);
	assert.match(html, /Hosted Next\.js application/);
	assert.match(html, /Accounts/);
	assert.match(html, /Database/);
	assert.match(html, /AI gateway/);
	assert.match(html, /No Electron/);
	assert.match(html, /AGPL-3\.0-only/);
	assert.ok(html.includes(`href="${SHUNKAN_SOURCE}"`));
	assert.ok(html.includes(`href="${LICENSE_URL}"`));
	assert.ok(html.includes('href="/users"'));
	assert.match(html, /knowledge-graph\.webp/);
	assert.match(html, /teaching-session\.webp/);
	assert.equal(SHUNKAN_SOURCE, "https://github.com/Razkaroth/shunkan");
});

test("unsigned home page renders the marketing entry", async () => {
	const { default: HomePage } = await import("../app/(product)/page.tsx");
	const html = renderToStaticMarkup(await HomePage());
	assert.match(html, /data-testid="marketing-home"/);
	assert.match(html, /A moment of learning\./);
	assert.ok(html.includes(`href="${LICENSE_URL}"`));
});
