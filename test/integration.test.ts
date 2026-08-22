/**
 * Live end-to-end tests against the real Exa API.
 * Opt-in: run with PI_EXA_E2E=1 and EXA_API_KEY set (costs a fraction of a cent).
 *
 *   PI_EXA_E2E=1 EXA_API_KEY=exa-... npm test
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { loadExtension, execute, searchTool, fetchTool } from "./helpers";

const enabled = process.env.PI_EXA_E2E === "1" && !!process.env.EXA_API_KEY;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe.skipIf(!enabled)("live Exa API", () => {
	// loadExtension() clears EXA_API_KEY by default — re-inject it for live runs
	const env = { EXA_API_KEY: process.env.EXA_API_KEY };

	it("web_search returns real results", async () => {
		const { tools } = await loadExtension({ env });
		const res = await execute(searchTool(tools), {
			query: "official Exa API documentation",
			numResults: 3,
		});
		expect(res.details.resultCount).toBeGreaterThan(0);
		expect(res.details.urls.length).toBeGreaterThan(0);
		expect(res.content[0].text).toContain("https://");
	}, 30_000);

	it("web_fetch reads a real page (incl. subpages)", async () => {
		const { tools } = await loadExtension({ env });
		const res = await execute(fetchTool(tools), {
			urls: "https://nodejs.org/en",
			maxCharacters: 500,
			subpages: 1,
		});
		expect(res.details.urlCount).toBe(1);
		expect(res.content[0].text.length).toBeGreaterThan(100);
	}, 60_000);
});
