// Typed client for the RegShield Go API. Shapes mirror API.md (the backend
// contract) exactly — see internal/api/ in the regshield repo.

export type EntityType = "NBFC" | "Payment_Bank" | "Mainstream_Bank";
export type Confidence = "verified" | "needs_review";
export type ChangeType = "added" | "removed" | "modified" | "unchanged";

export interface Citation {
  clause: string;
  last_updated: string;
  applicable_to: EntityType[];
}

export interface QueryRequest {
  text: string;
  entity_type: EntityType;
  regulation?: string;
}

export interface QueryResponse {
  answer: string;
  confidence: Confidence;
  citations: Citation[];
  warnings?: string[];
}

export interface DriftEntry {
  clause: string;
  change_type: ChangeType;
  old_text?: string;
  new_text?: string;
  similarity?: number;
}

export interface DriftReport {
  regulation: string;
  from: string;
  to: string;
  changes: DriftEntry[];
}

export interface IngestRequest {
  markdown: string;
  version: string;
  regulation?: string;
  source_url?: string;
  last_updated?: string;
}

export interface IngestResponse {
  status: "ok";
  chunks_count: number;
  regulation: string;
  version: string;
}

export const API_URL: string =
  import.meta.env.VITE_API_URL ?? "http://localhost:8080";

/** Thrown for any non-2xx response, carrying the server's `error` string. */
export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch {
    throw new ApiError(
      `Cannot reach the API at ${API_URL}. Is the backend running?`,
      0,
    );
  }
  const body = await res.json().catch(() => ({}) as Record<string, unknown>);
  if (!res.ok) {
    const msg =
      (body as { error?: string }).error ?? `Request failed (${res.status})`;
    throw new ApiError(msg, res.status);
  }
  return body as T;
}

export const regshield = {
  health: () => call<{ status: string }>("/health"),

  query: (req: QueryRequest) =>
    call<QueryResponse>("/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),

  drift: (regulation: string, from: string, to: string) =>
    call<DriftReport>(
      `/drift?regulation=${encodeURIComponent(regulation)}&from=${encodeURIComponent(
        from,
      )}&to=${encodeURIComponent(to)}`,
    ),

  ingest: (req: IngestRequest) =>
    call<IngestResponse>("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
};

export const ENTITY_TYPES: { value: EntityType; label: string }[] = [
  { value: "NBFC", label: "NBFC" },
  { value: "Payment_Bank", label: "Payment Bank" },
  { value: "Mainstream_Bank", label: "Mainstream Bank" },
];
