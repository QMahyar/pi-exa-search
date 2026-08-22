import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { loadExtension, stubFetch, jsonResponse, exaSearchResponse, execute, searchTool } from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("config loading & migration", () => {
	it("treats a missing config file as empty keys", async () => {
		const { tools } = await loadExtension();
		const { fn } = stubFetch(() => exaSearchResponse());
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(/No Exa API keys available/);
		expect(fn).not.toHaveBeenCalled();
	});

	it("migrates the legacy exaApiKey field into keys[]", async () => {
		const { tools } = await loadExtension({ config: { exaApiKey: "legacy-key-123456" } });
		const { fn } = stubFetch(() => exaSearchResponse());
		const res = await execute(searchTool(tools), { query: "x" });
		expect(fn).toHaveBeenCalledTimes(1);
		expect((fn.mock.calls[0] as any[])[1].headers["x-api-key"]).toBe("legacy-key-123456");
		expect(res.details.usedKey).toBe("default");
	});

	it("migrates legacy persisted cooldownUntil into the runtime map (all-on-cooldown error)", async () => {
		const { tools } = await loadExtension({
			config: { keys: [{ key: "abc123", cooldownUntil: Date.now() + 60_000 }] },
		});
		const { fn } = stubFetch(() => exaSearchResponse());
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(/all on cooldown/);
		expect(fn).not.toHaveBeenCalled();
	});

	it("recovers from a corrupted config file", async () => {
		const { tools } = await loadExtension({ config: "not json {{{" });
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(/No Exa API keys available/);
	});
});

describe("/exa command", () => {
	it("saves a new key via the TUI flow and strips non-persistent fields", async () => {
		const { commands, configPath } = await loadExtension();
		const handler = commands.find((c: any) => c.name === "exa")!.handler;

		const ui = {
			select: vi.fn().mockResolvedValueOnce("+ Add new key").mockResolvedValueOnce("Done"),
			input: vi
				.fn()
				.mockResolvedValueOnce("new-key-abcdefghijk")
				.mockResolvedValueOnce("work"),
			confirm: vi.fn().mockResolvedValue(false),
			notify: vi.fn(),
		};
		await handler([], { mode: "tui", hasUI: true, ui });

		const saved = JSON.parse(readFileSync(configPath, "utf-8"));
		expect(saved).toEqual({ keys: [{ key: "new-key-abcdefghijk", label: "work" }] });
		expect(ui.notify).toHaveBeenCalledWith("Key added (1 total)", "info");
	});

	it("refuses to run without interactive UI", async () => {
		const { commands } = await loadExtension();
		const handler = commands.find((c: any) => c.name === "exa")!.handler;
		const notify = vi.fn();
		await handler([], { mode: "headless", hasUI: false, ui: { notify } });
		expect(notify).toHaveBeenCalledWith("/exa needs interactive UI", "error");
	});

	it("rejects duplicate keys on add", async () => {
		const { commands } = await loadExtension({ config: { keys: [{ key: "dup-key-12345" }] } });
		const handler = commands.find((c: any) => c.name === "exa")!.handler;
		const ui = {
			select: vi.fn().mockResolvedValueOnce("+ Add new key").mockResolvedValueOnce("Done"),
			input: vi.fn().mockResolvedValueOnce("dup-key-12345").mockResolvedValueOnce(""),
			confirm: vi.fn(),
			notify: vi.fn(),
		};
		await handler([], { mode: "tui", hasUI: true, ui });
		expect(ui.notify).toHaveBeenCalledWith("Key already exists", "warning");
	});
});

describe("env fallback key", () => {
	it("uses EXA_API_KEY when no config keys exist", async () => {
		const { tools } = await loadExtension({ env: { EXA_API_KEY: "env-key-987654321" } });
		const { fn } = stubFetch(() => exaSearchResponse());
		const res = await execute(searchTool(tools), { query: "x" });
		expect((fn.mock.calls[0] as any[])[1].headers["x-api-key"]).toBe("env-key-987654321");
		expect(res.details.usedKey).toBe("env:EXA_API_KEY");
	});

	it("skips EXA_API_KEY when identical to a config key", async () => {
		const { tools } = await loadExtension({
			config: { keys: [{ key: "shared-key-1", label: "a" }] },
			env: { EXA_API_KEY: "shared-key-1" },
		});
		const { fn } = stubFetch(() => exaSearchResponse());
		const res = await execute(searchTool(tools), { query: "x" });
		expect(fn).toHaveBeenCalledTimes(1);
		expect(res.details.usedKey).toBe("a"); // config label, not env label
	});

	it("cooling-down env key is skipped and reported", async () => {
		// Indirectly cool the env key down by hitting a 429 first.
		const { tools } = await loadExtension({ env: { EXA_API_KEY: "env-key-2222" } });
		let status = 429;
		stubFetch(() => (status === 429 ? jsonResponse(429, {}, { "retry-after": "120" }) : exaSearchResponse()));
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(/rate limited/);
		status = 200;
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(/all on cooldown/);
	});
});

describe("request shape", () => {
	it("uses only the documented x-api-key header", async () => {
		const { tools } = await loadExtension({ config: { keys: [{ key: "k", label: "one" }] } });
		const { fn } = stubFetch(() => exaSearchResponse());
		await execute(searchTool(tools), { query: "x" });
		const headers = (fn.mock.calls[0] as any[])[1].headers;
		expect(headers["x-api-key"]).toBe("k");
		expect(headers["Authorization"]).toBeUndefined();
		expect(headers["Content-Type"]).toBe("application/json");
	});

	it("sends a minimal default search body", async () => {
		const { tools } = await loadExtension({ config: { keys: [{ key: "k" }] } });
		const { calls } = stubFetch(() => exaSearchResponse());
		await execute(searchTool(tools), { query: "hello world" });
		expect(calls[0].url).toBe("https://api.exa.ai/search");
		expect(calls[0].body).toEqual({
			query: "hello world",
			numResults: 5,
			type: "auto",
			contents: { highlights: true },
		});
	});
});
