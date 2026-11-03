import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketingHome, SHUNKAN_LICENSE, SHUNKAN_SOURCE } from "../components/marketing/home.tsx";

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
	assert.ok(html.includes(`href="${SHUNKAN_LICENSE}"`));
	assert.ok(html.includes('href="/users"'));
	assert.match(html, /knowledge-graph\.webp/);
	assert.match(html, /teaching-session\.webp/);
	assert.equal(SHUNKAN_SOURCE, "https://github.com/Razkaroth/shunkan");
});
