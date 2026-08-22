import { describe, it, expect, vi, afterEach } from "vitest";
import { loadExtension, stubFetch, jsonResponse, exaSearchResponse, execute, searchTool } from "./helpers";

afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

const TWO_KEYS = { keys: [{ key: "key-one", label: "first" }, { key: "key-two", label: "second" }] };

describe("key rotation on rate limits and auth errors", () => {
	it("rotates to the next key on 429 and honors retry-after cooldown", async () => {
		const { tools } = await loadExtension({ config: TWO_KEYS });
		const { fn, calls } = stubFetch((req) =>
			req.headers["x-api-key"] === "key-one"
				? jsonResponse(429, {}, { "retry-after": "3" })
				: exaSearchResponse(),
		);
		const res = await execute(searchTool(tools), { query: "x" });
		expect(res.details.usedKey).toBe("second");
		expect(fn).toHaveBeenCalledTimes(2);

		// Key one is now cooling down for ~3s — next call goes straight to key two
		await execute(searchTool(tools), { query: "y" });
		expect(calls[2].headers["x-api-key"]).toBe("key-two");
	});

	it("applies the default 60s cooldown when 429 has no retry-after", async () => {
		const { tools } = await loadExtension({ config: TWO_KEYS });
		stubFetch(() => jsonResponse(429, {}));
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(
			/rate limited \(cooldown 6[01]s\)/,
		);
	});

	it("puts 401 keys on a long cooldown", async () => {
		const { tools } = await loadExtension({ config: TWO_KEYS });
		const { calls } = stubFetch((req) =>
			req.headers["x-api-key"] === "key-one" ? jsonResponse(401, {}) : exaSearchResponse(),
		);
		const res = await execute(searchTool(tools), { query: "x" });
		expect(res.details.usedKey).toBe("second");
		await execute(searchTool(tools), { query: "y" });
		expect(calls[2].headers["x-api-key"]).toBe("key-two");
	});

	it("puts 402 keys on a 10-minute cooldown", async () => {
		const { tools } = await loadExtension({ config: TWO_KEYS });
		stubFetch(() => jsonResponse(402, {}));
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(
			/failed after 2 key\(s\)[\s\S]*payment required[\s\S]*cooldown 10m/,
		);
	});

	it("fails with a multi-key summary when every key is exhausted", async () => {
		const { tools } = await loadExtension({ config: TWO_KEYS });
		stubFetch(() => jsonResponse(429, {}));
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(
			/web_search failed after 2 key\(s\)[\s\S]*rate limited/,
		);
	});

	it("does not rotate keys on a non-transient 4xx (bad request)", async () => {
		const { tools } = await loadExtension({ config: TWO_KEYS });
		const { fn } = stubFetch(() => jsonResponse(400, { error: "bad param" }));
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(/400[\s\S]*bad param/);
		expect(fn).toHaveBeenCalledTimes(1); // second key never tried
	});
});

describe("transient failures: retry same key with backoff", () => {
	it("retries a key on 500 before rotating (fake timers)", async () => {
		vi.useFakeTimers();
		const { tools } = await loadExtension({ config: TWO_KEYS });
		let keyOneAttempts = 0;
		const { calls } = stubFetch((req) => {
			if (req.headers["x-api-key"] === "key-one") {
				keyOneAttempts++;
				return keyOneAttempts < 3 ? jsonResponse(500, {}) : exaSearchResponse();
			}
			return exaSearchResponse();
		});
		const pending = execute(searchTool(tools), { query: "x" });
		await vi.advanceTimersByTimeAsync(1200); // 300ms + 900ms backoff
		const res = await pending;
		expect(res.details.usedKey).toBe("first"); // recovered on same key
		expect(calls).toHaveLength(3);
	});

	it("exhausts retries then rotates to the next key", async () => {
		vi.useFakeTimers();
		const { tools } = await loadExtension({ config: TWO_KEYS });
		const { calls } = stubFetch((req) =>
			req.headers["x-api-key"] === "key-one" ? jsonResponse(503, {}) : exaSearchResponse(),
		);
		const pending = execute(searchTool(tools), { query: "x" });
		await vi.advanceTimersByTimeAsync(2400); // key-one: 300+900, key-two succeeds
		const res = await pending;
		expect(res.details.usedKey).toBe("second");
		expect(calls.filter((c) => c.headers["x-api-key"] === "key-one")).toHaveLength(3);
	});

	it("retries network errors on the same key", async () => {
		vi.useFakeTimers();
		const { tools } = await loadExtension({ config: TWO_KEYS });
		let callsOnKeyOne = 0;
		const { calls } = stubFetch((req) => {
			if (req.headers["x-api-key"] === "key-one") {
				callsOnKeyOne++;
				if (callsOnKeyOne < 2) throw new TypeError("fetch failed");
			}
			return exaSearchResponse();
		});
		const pending = execute(searchTool(tools), { query: "x" });
		await vi.advanceTimersByTimeAsync(300);
		const res = await pending;
		expect(res.details.usedKey).toBe("first");
		expect(calls).toHaveLength(2);
	});
});

describe("timeouts and aborts", () => {
	it("times out a hung request and reports it (real timers, short timeout)", async () => {
		const { tools } = await loadExtension({ config: { keys: [{ key: "slow-key" }] }, timeoutMs: 80 });
		const { fn } = stubFetch(
			(req) =>
				new Promise((_resolve, reject) => {
					req.signal?.addEventListener("abort", () =>
						reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })),
					);
				}) as Promise<Response>,
		);
		const started = Date.now();
		await expect(execute(searchTool(tools), { query: "x" })).rejects.toThrow(/timed out after \d+s/);
		expect(Date.now() - started).toBeGreaterThanOrEqual(70);
		// 1 initial attempt + 2 retries for a single key
		expect(fn).toHaveBeenCalledTimes(3);
	}, 10_000);

	it("respects a pre-aborted caller signal without touching the network", async () => {
		const { tools } = await loadExtension({ config: TWO_KEYS });
		const { fn } = stubFetch(() => exaSearchResponse());
		const ac = new AbortController();
		ac.abort();
		await expect(execute(searchTool(tools), { query: "x" }, ac.signal)).rejects.toThrow(/aborted/);
		expect(fn).not.toHaveBeenCalled();
	});

	it("respects an abort mid-flight (during backoff sleep)", async () => {
		vi.useFakeTimers();
		const { tools } = await loadExtension({ config: TWO_KEYS });
		const ac = new AbortController();
		stubFetch(() => jsonResponse(500, {}));
		const pending = execute(searchTool(tools), { query: "x" }, ac.signal);
		// Attach the rejection expectation up front so vitest doesn't see it as unhandled
		const assertion = expect(pending).rejects.toThrow(/aborted/);
		// let the first attempt land, then abort during the 300ms backoff
		await vi.advanceTimersByTimeAsync(0);
		ac.abort();
		await vi.advanceTimersByTimeAsync(5000);
		await assertion;
	});
});
