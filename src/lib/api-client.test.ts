
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FALLBACK_ENTRIES,
  fetchCapabilities,
  fetchWithTimeout,
} from "./api-client";

describe("api-client", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("fetchWithTimeout", () => {
    it("returns parsed json data when request succeeds", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok", count: 42 }),
      });

      const res = await fetchWithTimeout("https://api.example.com/test");
      expect(res.ok).toBe(true);

      if (res.ok) {
        expect(res.data).toEqual({ status: "ok", count: 42 });
      }
    });

    it("returns http error when response is not ok (404/500)", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: "Not Found",
      });

      const res = await fetchWithTimeout("https://api.example.com/test");
      expect(res.ok).toBe(false);

      if (!res.ok) {
        expect(res.error.kind).toBe("http");
        expect(res.error.statusCode).toBe(404);
        expect(res.error.message).toContain("404");
      }
    });

    it("returns malformed error when response is not valid json", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError("Unexpected token < in JSON");
        },
      });

      const res = await fetchWithTimeout("https://api.example.com/test");
      expect(res.ok).toBe(false);

      if (!res.ok) {
        expect(res.error.kind).toBe("malformed");
        expect(res.error.message).toContain("invalid or unparseable JSON");
      }
    });

    it("returns timeout error when AbortError is raised", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";
      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      const res = await fetchWithTimeout("https://api.example.com/test", {}, 10);
      expect(res.ok).toBe(false);

      if (!res.ok) {
        expect(res.error.kind).toBe("timeout");
        expect(res.error.message).toContain("timed out");
      }
    });

    it("preserves timeout error when AbortError occurs while reading response json body", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "AbortError";

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw abortError;
        },
      });

      const res = await fetchWithTimeout("https://api.example.com/test", {}, 10);
      expect(res.ok).toBe(false);

      if (!res.ok) {
        expect(res.error.kind).toBe("timeout");
        expect(res.error.message).toContain("timed out");
      }
    });

    it("preserves timeout error when request abort signal is set while reading response json body", async () => {
      const callerController = new AbortController();

      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          callerController.abort();
          throw new SyntaxError("Unexpected end of JSON input");
        },
      });

      const res = await fetchWithTimeout(
        "https://api.example.com/test",
        { signal: callerController.signal },
        5000,
      );

      expect(res.ok).toBe(false);

      if (!res.ok) {
        expect(res.error.kind).toBe("timeout");
        expect(res.error.message).toContain("timed out");
      }
    });

    it("returns network error when fetch throws network failure", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(
        new TypeError("Failed to fetch"),
      );

      const res = await fetchWithTimeout("https://api.example.com/test");
      expect(res.ok).toBe(false);

      if (!res.ok) {
        expect(res.error.kind).toBe("network");
        expect(res.error.message).toContain("Failed to fetch");
      }
    });
  });

  describe("fetchCapabilities", () => {
    it("normalizes valid Core providers into Dashboard capabilities", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          providers: [
            {
              name: "Notion",
              direction: "source",
              status: "implemented",
              milestone: "M3",
            },
            {
              name: "Huly",
              direction: "target",
              status: "implemented",
              milestone: "M6",
            },
            {
              name: "Trello",
              direction: "source",
              status: "planned",
              milestone: "v0.3",
            },
          ],
        }),
      });

      const res = await fetchCapabilities();

      expect(res.isFallback).toBe(false);
      expect(res.error).toBeNull();
      expect(res.data).toEqual([
        {
          id: "notion-source",
          name: "Notion",
          kind: "source",
          status: "Supported",
          detail: "Milestone M3",
        },
        {
          id: "huly-target",
          name: "Huly",
          kind: "target",
          status: "Supported",
          detail: "Milestone M6",
        },
        {
          id: "trello-source",
          name: "Trello",
          kind: "source",
          status: "Planned",
          detail: "Milestone v0.3",
        },
      ]);
    });

    it("rejects providers with unsupported both direction", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          providers: [
            {
              name: "Notion",
              direction: "both",
              status: "implemented",
              milestone: "M3",
            },
          ],
        }),
      });

      const res = await fetchCapabilities();

      expect(res.isFallback).toBe(true);
      expect(res.error?.kind).toBe("malformed");
      expect(res.data).toEqual(FALLBACK_ENTRIES);
    });

    it("falls back to bundled entries when API returns non-200", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        statusText: "Service Unavailable",
      });

      const res = await fetchCapabilities();

      expect(res.isFallback).toBe(true);
      expect(res.error?.kind).toBe("http");
      expect(res.data).toEqual(FALLBACK_ENTRIES);
    });

    it("falls back when the providers array is missing", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      });

      const res = await fetchCapabilities();

      expect(res.isFallback).toBe(true);
      expect(res.error?.kind).toBe("malformed");
      expect(res.error?.message).toContain("providers");
      expect(res.data).toEqual(FALLBACK_ENTRIES);
    });

    it("rejects the legacy adapters response contract", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          adapters: [
            {
              id: "notion",
              name: "Notion",
              direction: "source",
              status: "Supported",
            },
          ],
        }),
      });

      const res = await fetchCapabilities();

      expect(res.isFallback).toBe(true);
      expect(res.error?.kind).toBe("malformed");
      expect(res.data).toEqual(FALLBACK_ENTRIES);
    });

    it("returns an empty list when providers is empty", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          providers: [],
        }),
      });

      const res = await fetchCapabilities();

      expect(res.isFallback).toBe(false);
      expect(res.error).toBeNull();
      expect(res.data).toEqual([]);
    });

    it.each([
      {
        name: "Missing provider name",
        provider: {
          direction: "source",
          status: "implemented",
          milestone: "M3",
        },
      },
      {
        name: "Empty provider name",
        provider: {
          name: "   ",
          direction: "source",
          status: "implemented",
          milestone: "M3",
        },
      },
      {
        name: "Invalid direction",
        provider: {
          name: "Notion",
          direction: "invalid",
          status: "implemented",
          milestone: "M3",
        },
      },
      {
        name: "Invalid status",
        provider: {
          name: "Notion",
          direction: "source",
          status: "unknown",
          milestone: "M3",
        },
      },
      {
        name: "Missing milestone",
        provider: {
          name: "Notion",
          direction: "source",
          status: "implemented",
        },
      },
      {
        name: "Non-string milestone",
        provider: {
          name: "Notion",
          direction: "source",
          status: "implemented",
          milestone: 3,
        },
      },
      {
        name: "Whitespace-only milestone",
        provider: {
          name: "Notion",
          direction: "source",
          status: "implemented",
          milestone: "   ",
        },
      },
    ])("falls back for $name", async ({ provider }) => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          providers: [provider],
        }),
      });

      const res = await fetchCapabilities();

      expect(res.isFallback).toBe(true);
      expect(res.error?.kind).toBe("malformed");
      expect(res.data).toEqual(FALLBACK_ENTRIES);
    });

    it("falls back when providers contains arrays or empty objects", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          providers: [[], {}],
        }),
      });

      const res = await fetchCapabilities();

      expect(res.isFallback).toBe(true);
      expect(res.error?.kind).toBe("malformed");
      expect(res.data).toEqual(FALLBACK_ENTRIES);
    });
  });
});
