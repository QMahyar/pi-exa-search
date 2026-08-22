import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import {
	loadExtension,
	stubFetch,
	jsonResponse,
	exaSearchResponse,
	execute,
	searchTool,
	fetchTool,
	fakeTheme,
} from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
});

const ONE_KEY = { keys: [{ key: "k", label: "main" }] };

describe("web_search schema", () => {
	it("uses string enums for recencyFilter and type", async () => {
		const { tools } = await loadExtension();
		const props = (searchTool(tools).parameters as any).properties;
		expect(props.recencyFilter.enum).toEqual(["day", "week", "month", "year"]);
		expect(props.type.enum).toEqual([
			"auto",
			"fast",
			"instant",
			"deep-lite",
			"deep",
			"deep-reasoning",
		]);
		expect(props.category.type).toBe("string"); // free-form hint, not a closed enum
		expect(props.maxAgeHours).toBeUndefined(); // fetch-only param
	});

	it("names a tool in every prompt guideline (pi renders them without a tool prefix)", async () => {
		const { tools } = await loadExtension();
		for (const tool of [searchTool(tools), fetchTool(tools)]) {
			for (const g of tool.promptGuidelines) {
				expect(g).toMatch(/\b(web_search|web_fetch)\b/);
			}
		}
	});
});

describe("web_search request building", () => {
	it("passes through filters (domains, category, type, recency)", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const { calls } = stubFetch(() => exaSearchResponse());
		await execute(searchTool(tools), {
			query: "q",
			includeDomains: "https://docs.python.org, github.com/",
			excludeDomains: "pinterest.com quora.com",
			category: "news",
			type: "deep-lite",
			recencyFilter: "week",
			numResults: 3,
		});
		const body = calls[0].body;
		expect(body.includeDomains).toEqual(["docs.python.org", "github.com"]);
		expect(body.excludeDomains).toEqual(["pinterest.com", "quora.com"]);
		expect(body.category).toBe("news");
		expect(body.type).toBe("deep-lite");
		expect(body.numResults).toBe(3);
		expect(body.startPublishedDate).toBeDefined();
		expect(new Date(body.startPublishedDate).getTime()).toBeGreaterThan(Date.now() - 8 * 864e5);
		expect(new Date(body.startPublishedDate).getTime()).toBeLessThan(Date.now() - 6 * 864e5);
	});

	it("drops recency and excludeDomains for restricted categories (company/people)", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const { calls } = stubFetch(() => exaSearchResponse());
		await execute(searchTool(tools), {
			query: "q",
			category: "company",
			recencyFilter: "day",
			excludeDomains: "pinterest.com",
		});
		const body = calls[0].body;
		expect(body.category).toBe("company");
		expect(body.startPublishedDate).toBeUndefined();
		expect(body.excludeDomains).toBeUndefined();
	});

	it("adds text contents only when includeText is set", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const { calls } = stubFetch(() => exaSearchResponse());
		await execute(searchTool(tools), { query: "q", includeText: true, maxCharacters: 900 });
		expect(calls[0].body.contents).toEqual({ highlights: true, text: { maxCharacters: 900 } });
	});

	it("caps numResults at 20", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const { calls } = stubFetch(() => exaSearchResponse());
		await execute(searchTool(tools), { query: "q", numResults: 50 });
		expect(calls[0].body.numResults).toBe(20);
	});

	it("rejects an empty query by throwing", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		stubFetch(() => exaSearchResponse());
		await expect(execute(searchTool(tools), { query: "   " })).rejects.toThrow(/query is required/);
	});
});

describe("web_search results", () => {
	it("formats highlights, meta, and details", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		stubFetch(() =>
			exaSearchResponse([
				{
					title: "Exa Docs",
					url: "https://exa.ai/docs",
					publishedDate: "2026-01-15T00:00:00Z",
					author: "Exa",
					score: 0.9876,
					highlights: ["Neural search for apps.", "  "],
				},
			]),
		);
		const res = await execute(searchTool(tools), { query: "exa docs" });
		expect(res.isError).toBeUndefined();
		expect(res.details.resultCount).toBe(1);
		expect(res.details.urls).toEqual(["https://exa.ai/docs"]);
		expect(res.details.requestId).toBe("req-1");
		expect(res.details.costUsd).toBeCloseTo(0.001);
		expect(res.content[0].text).toContain("### 1. Exa Docs");
		expect(res.content[0].text).toContain("Published: 2026-01-15 · Author: Exa · Score: 0.988");
		expect(res.content[0].text).toContain("- Neural search for apps.");
		expect(res.content[0].text).not.toContain("-   "); // blank highlight dropped
	});

	it("reports zero results without erroring", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		stubFetch(() => exaSearchResponse([]));
		const res = await execute(searchTool(tools), { query: "nothing" });
		expect(res.details.resultCount).toBe(0);
		expect(res.content[0].text).toBe("No results for: nothing");
	});

	it("truncates oversized output to a temp file and says so", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const big = Array.from({ length: 30 }, (_, i) => ({
			title: `Page ${i}`,
			url: `https://example.com/${i}`,
			text: "x".repeat(4000),
		}));
		stubFetch(() => exaSearchResponse(big));
		const res = await execute(searchTool(tools), { query: "big", includeText: true });
		expect(res.details.truncated).toBe(true);
		const path = res.details.fullOutputPath as string;
		expect(path).toBeTruthy();
		expect(res.content[0].text).toContain(`[Output truncated:`);
		expect(res.content[0].text).toContain(path);
		const saved = readFileSync(path, "utf-8");
		expect(saved).toContain("https://example.com/29"); // full payload, unlike the trimmed text
		expect(saved.length).toBeGreaterThan(res.content[0].text.length);
	}, 20_000);
});

describe("web_fetch", () => {
	it("parses mixed URL input and builds the contents body", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const { calls } = stubFetch(() =>
			jsonResponse(200, {
				results: [{ title: "A", url: "https://a.dev", text: "content a" }],
				requestId: "r",
			}),
		);
		const res = await execute(fetchTool(tools), {
			urls: "https://a.dev, not-a-url http://b.dev",
			highlightsQuery: "pricing",
		});
		expect(calls[0].url).toBe("https://api.exa.ai/contents");
		expect(calls[0].body.urls).toEqual(["https://a.dev", "http://b.dev"]);
		expect(calls[0].body.highlights).toEqual({ query: "pricing" });
		expect(calls[0].body.text.maxCharacters).toBe(5000);
		expect(res.details.urlCount).toBe(1);
		expect(res.content[0].text).toContain("content a");
	});

	it("throws on invalid URL input with guidance", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const { fn } = stubFetch(() => exaSearchResponse());
		await expect(execute(fetchTool(tools), { urls: "example.com foo" })).rejects.toThrow(
			/no valid URLs/i,
		);
		expect(fn).not.toHaveBeenCalled();
	});

	it("passes maxAgeHours, subpages, and subpageTarget", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const { calls } = stubFetch(() => jsonResponse(200, { results: [{ url: "https://a.dev" }] }));
		await execute(fetchTool(tools), {
			urls: "https://a.dev",
			maxAgeHours: 24,
			subpages: 5,
			subpageTarget: "docs, api",
		});
		expect(calls[0].body.maxAgeHours).toBe(24);
		expect(calls[0].body.subpages).toBe(5);
		expect(calls[0].body.subpageTarget).toEqual(["docs", "api"]);
	});

	it("ignores subpageTarget when subpages is not set", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const { calls } = stubFetch(() => jsonResponse(200, { results: [{ url: "https://a.dev" }] }));
		await execute(fetchTool(tools), { urls: "https://a.dev", subpageTarget: "docs" });
		expect(calls[0].body.subpages).toBeUndefined();
		expect(calls[0].body.subpageTarget).toBeUndefined();
	});

	it("renders nested subpages with their content", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		stubFetch(() =>
			jsonResponse(200, {
				results: [
					{
						title: "Root",
						url: "https://nodejs.org/en",
						text: "root content",
						subpages: [
							{ title: "Learn", url: "https://nodejs.org/learn", text: "learn content" },
							{ title: "About", url: "https://nodejs.org/about", text: "about content" },
						],
					},
				],
			}),
		);
		const res = await execute(fetchTool(tools), { urls: "https://nodejs.org/en", subpages: 2 });
		expect(res.content[0].text).toContain("**Subpages:**");
		expect(res.content[0].text).toContain("#### Learn");
		expect(res.content[0].text).toContain("https://nodejs.org/learn");
		expect(res.content[0].text).toContain("learn content");
		expect(res.content[0].text).toContain("about content");
	});

	it("reports per-URL statuses when nothing comes back", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		stubFetch(() =>
			jsonResponse(200, {
				results: [],
				statuses: [{ id: "https://a.dev", status: "error", error: "404" }],
			}),
		);
		await expect(execute(fetchTool(tools), { urls: "https://a.dev" })).rejects.toThrow(
			/no content returned[\s\S]*https:\/\/a\.dev: error \(404\)/,
		);
	});
});

describe("renderers", () => {
	it("renders collapsed and expanded views without theme access issues", async () => {
		const { tools } = await loadExtension({ config: ONE_KEY });
		const s = searchTool(tools);
		const f = fetchTool(tools);

		const collapsed = s.renderResult(
			{ content: [], details: { resultCount: 3, query: "q", usedKey: "main", urls: ["u1"] } },
			{ expanded: false, isPartial: false },
			fakeTheme,
		);
		expect((collapsed as any).text).toContain("web_search");
		expect((collapsed as any).text).toContain("3 hits");

		const partial = s.renderResult({ content: [] }, { expanded: false, isPartial: true }, fakeTheme);
		expect((partial as any).text).toContain("searching…");

		const fCollapsed = f.renderResult(
			{ content: [], details: { urlCount: 2, urls: ["u1", "u2"] } },
			{ expanded: false, isPartial: false },
			fakeTheme,
		);
		expect((fCollapsed as any).text).toContain("2 pages");
	});

	it("renders an error result without crashing (details may be absent)", async () => {
		const { tools } = await loadExtension();
		const s = searchTool(tools);
		expect(
			s.renderResult({ content: [{ type: "text", text: "boom" }] }, { expanded: true, isPartial: false }, fakeTheme),
		).toBeTruthy();
	});
});
