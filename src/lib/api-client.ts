import { API_URL } from "@/lib/config";

/**
 * Formal API contracts and data models for PortaD dashboard-to-core communication.
 * Ref: Sprint 1 (Issue #29) & Core Contracts (Core Issue #5).
 */

export type AdapterKind = "source" | "target";
export type AdapterStatus = "Supported" | "Planned";

export interface AdapterCapability {
  id: string;
  name: string;
  kind: AdapterKind;
  status: AdapterStatus;
  detail: string;
}

export interface CompatibilityPair {
  source: string;
  target: string;
  status: AdapterStatus;
  fidelity?: "high" | "medium" | "low";
  detail?: string;
}

export type ApiErrorKind =
  | "network"
  | "timeout"
  | "http"
  | "malformed"
  | "unknown";

export interface ApiError {
  kind: ApiErrorKind;
  message: string;
  statusCode?: number;
}

export interface ApiResult<T> {
  data: T;
  error: ApiError | null;
  isFallback: boolean;
}

/**
 * Standard offline fallback entries guaranteeing UI operational continuity
 * when core API service is unreachable or during air-gapped deployments.
 */
export const FALLBACK_ENTRIES: AdapterCapability[] = [
  {
    id: "notion-source",
    name: "Notion",
    status: "Supported",
    detail: "Pages, databases, records, attachments, relations",
    kind: "source",
  },
  {
    id: "fixtures-source",
    name: "Fixtures demo",
    status: "Supported",
    detail: "Synthetic workspace for tests and demos",
    kind: "source",
  },
  {
    id: "trello-source",
    name: "Trello",
    status: "Planned",
    detail: "Milestone 0.3",
    kind: "source",
  },
  {
    id: "clickup-source",
    name: "ClickUp",
    status: "Planned",
    detail: "Milestone 0.4",
    kind: "source",
  },
  {
    id: "asana-source",
    name: "Asana",
    status: "Planned",
    detail: "Milestone 0.4",
    kind: "source",
  },
  {
    id: "huly-target",
    name: "Huly",
    status: "Supported",
    detail: "Unified Import Format workspace",
    kind: "target",
  },
  {
    id: "notion-target",
    name: "Notion",
    status: "Planned",
    detail: "Round-trip import",
    kind: "target",
  },
];

/**
 * Fetch wrapper with timeout and standardized error classification.
 */
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 5000,
): Promise<{ ok: true; data: unknown } | { ok: false; error: ApiError }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const callerSignal = options.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener("abort", onCallerAbort, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      return {
        ok: false,
        error: {
          kind: "http",
          message: `Request failed with status ${response.status} (${response.statusText || "HTTP Error"})`,
          statusCode: response.status,
        },
      };
    }

    try {
      const data = await response.json();
      return { ok: true, data };
    } catch (parseErr: unknown) {
      if (
        (parseErr as { name?: string })?.name === "AbortError" ||
        controller.signal.aborted
      ) {
        return {
          ok: false,
          error: {
            kind: "timeout",
            message: `Request timed out after ${timeoutMs}ms.`,
          },
        };
      }
      return {
        ok: false,
        error: {
          kind: "malformed",
          message: "API returned an invalid or unparseable JSON payload.",
        },
      };
    }
  } catch (err: unknown) {
    if (
      (err as { name?: string })?.name === "AbortError" ||
      controller.signal.aborted
    ) {
      return {
        ok: false,
        error: {
          kind: "timeout",
          message: `Request timed out after ${timeoutMs}ms.`,
        },
      };
    }
    if (err instanceof Error) {
      return {
        ok: false,
        error: {
          kind: "network",
          message: err.message || "Network connection failed.",
        },
      };
    }
    return {
      ok: false,
      error: {
        kind: "unknown",
        message: "An unknown network error occurred.",
      },
    };
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener("abort", onCallerAbort);
    }
  }
}



/**
 * Fetches dynamic platform provider capabilities from PortaD Core API.
 * Normalizes Core's providers contract into the Dashboard adapter model.
 * Gracefully falls back to the bundled catalog if the API is unavailable.
 */
export async function fetchCapabilities(): Promise<ApiResult<AdapterCapability[]>> {
  const result = await fetchWithTimeout(`${API_URL}/api/v1/capabilities`);

  if (!result.ok) {
    return {
      data: FALLBACK_ENTRIES,
      error: result.error,
      isFallback: true,
    };
  }

  const payload = result.data as {
    providers?: unknown;
  } | null;

  if (!payload || !Array.isArray(payload.providers)) {
    return {
      data: FALLBACK_ENTRIES,
      error: {
        kind: "malformed",
        message: "Response missing expected 'providers' list.",
      },
      isFallback: true,
    };
  }

  const entries: AdapterCapability[] = [];

  for (const provider of payload.providers) {
    if (
      !provider ||
      typeof provider !== "object" ||
      Array.isArray(provider)
    ) {
      return {
        data: FALLBACK_ENTRIES,
        error: {
          kind: "malformed",
          message: "Response contains malformed provider entries.",
        },
        isFallback: true,
      };
    }

    const item = provider as {
      name?: unknown;
      direction?: unknown;
      status?: unknown;
      milestone?: unknown;
    };

    if (
      typeof item.name !== "string" ||
      !item.name.trim() ||
      (item.direction !== "source" &&
        item.direction !== "target") ||
      (item.status !== "implemented" &&
        item.status !== "planned") ||
      typeof item.milestone !== "string" ||
      !item.milestone.trim()
    ) {
      return {
        data: FALLBACK_ENTRIES,
        error: {
          kind: "malformed",
          message: "Response contains malformed provider entries.",
        },
        isFallback: true,
      };
    }

    const name = item.name.trim();

    const kind: AdapterKind = item.direction;

    const status: AdapterStatus =
      item.status === "implemented" ? "Supported" : "Planned";

    const detail = `Milestone ${item.milestone.trim()}`;

    const idPrefix =
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") ||
      "provider";

    entries.push({
      id: `${idPrefix}-${kind}`,
      name,
      kind,
      status,
      detail,
    });
  }

  return {
    data: entries,
    error: null,
    isFallback: false,
  };
}
