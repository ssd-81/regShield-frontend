# RegShield API Contract

HTTP JSON API for a frontend (or any client) to consume. This is the source of
truth for request/response shapes — generated from the handler code in
`internal/api/`. Drop a copy in your frontend repo (e.g. as `CLAUDE.md` or
`docs/regshield-api.md`) so Claude Code can generate correct, type-safe calls.

## Base URL & connection

| Environment | Base URL |
|-------------|----------|
| Local dev   | `http://localhost:8080` |
| Custom port | `http://localhost:${SERVER_PORT}` |

- **CORS**: fully open — `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`,
  allowed header `Content-Type`. A browser SPA can call the API directly; no proxy needed.
- **Content type**: all `POST` bodies are JSON; send `Content-Type: application/json`.
- **Auth**: none. (The Jina/Groq API keys live server-side only — never sent to the client.)

Point your frontend at the base URL via an env var, e.g. `VITE_API_URL` /
`NEXT_PUBLIC_API_URL`, defaulting to `http://localhost:8080`.

## Shared types

```ts
type EntityType = "NBFC" | "Payment_Bank" | "Mainstream_Bank";

type Confidence = "verified" | "needs_review";

type ChangeType = "added" | "removed" | "modified" | "unchanged";

interface Citation {
  clause: string;         // e.g. "Section 16 V-CIP (Video based Customer Identification)"
  last_updated: string;   // version date string, e.g. "2024-11-06"
  applicable_to: EntityType[];
}
```

## Error format

Any 4xx/5xx returns a JSON object with a single `error` string:

```json
{ "error": "text field is required" }
```

Common statuses: `400` (validation / bad JSON), `404` (drift version not found),
`500` (upstream embedding / LLM / vector-store failure).

---

## `GET /health`

Liveness check. No body.

**200**
```json
{ "status": "ok" }
```

---

## `POST /query`

Entity-scoped, guardrailed compliance answer with citations. Retrieves up to 5
clauses filtered to `entity_type` (and `regulation` if given), asks the LLM, then
**mechanically validates** the answer: every ₹-amount or timeline must carry a
clause citation, and every cited clause must exist in the retrieved set. If any
check fails, `confidence` is `"needs_review"` and `warnings` explains why.

**Request**
```ts
interface QueryRequest {
  text: string;          // required — the natural-language question
  entity_type: EntityType; // required
  regulation?: string;   // optional filter, e.g. "KYC_Master_Direction"
}
```

**200 Response**
```ts
interface QueryResponse {
  answer: string;
  confidence: Confidence;
  citations: Citation[];
  warnings?: string[];   // present only when confidence === "needs_review"
}
```

Notes:
- If no clauses match, returns `200` with `answer` = "No relevant clauses found…"
  and `confidence: "needs_review"` (empty citations).
- `400` if `text` or `entity_type` is missing.

**Example**
```bash
curl -sS -X POST http://localhost:8080/query \
  -H 'Content-Type: application/json' \
  -d '{"text":"What is the credit ceiling and CDD deadline for Aadhaar OTP e-KYC?",
       "entity_type":"NBFC","regulation":"KYC_Master_Direction"}'
```

---

## `GET /drift`

Clause-level semantic diff between two dated versions of the same regulation.

**Query params**

| Param        | Required | Default                | Notes |
|--------------|----------|------------------------|-------|
| `regulation` | no       | `KYC_Master_Direction` | which regulation to diff |
| `from`       | yes      | —                      | old version string (e.g. `2024-01-04`) |
| `to`         | yes      | —                      | new version string (e.g. `2024-11-06`) |

**200 Response**
```ts
interface DriftReport {
  regulation: string;
  from: string;
  to: string;
  changes: DriftEntry[];
}

interface DriftEntry {
  clause: string;
  change_type: ChangeType;
  old_text?: string;    // absent for "added"
  new_text?: string;    // absent for "removed"
  similarity?: number;  // 0..1 cosine; absent for "added"/"removed"
}
```

Semantics (see `internal/drift/differ.go`):
- Clause only in `to` → `"added"`; only in `from` → `"removed"`.
- Clause in both → cosine similarity of the two texts.
  `similarity < 0.92` ⇒ `"modified"`, otherwise `"unchanged"`.
- ⚠️ **Known limitation**: the `0.92` threshold is lenient. Substantive edits like
  a credit-ceiling change (one lakh → two lakh) score ~0.9999 and are reported as
  `"unchanged"`. Don't treat `"unchanged"` as "textually identical" — compare
  `old_text`/`new_text` in the UI if you need exactness.

Errors: `400` if `from`/`to` missing; `404` if either version has 0 stored clauses.

**Example**
```bash
curl -sS "http://localhost:8080/drift?regulation=KYC_Master_Direction&from=2024-01-04&to=2024-11-06"
```

---

## `POST /ingest`

Chunk a regulation's markdown at the clause level, embed each clause, and upsert
into the vector store under `(regulation, version)`. Usually run server-side / via
`scripts/seed.sh`, but exposed for admin UIs.

**Request**
```ts
interface IngestRequest {
  markdown: string;      // required — full regulation text (markdown)
  version: string;       // required — version tag, e.g. "2024-11-06"
  regulation?: string;   // defaults to "KYC_Master_Direction" if omitted
  source_url?: string;
  last_updated?: string;
}
```

**200 Response**
```ts
interface IngestResponse {
  status: "ok";
  chunks_count: number;
  regulation: string;
  version: string;
}
```

Errors: `400` if `markdown` or `version` missing; `500` on embedding/upsert failure.

---

## Minimal fetch client

```ts
const API = import.meta.env.VITE_API_URL ?? "http://localhost:8080";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, init);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `API ${res.status}`);
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
      `/drift?regulation=${encodeURIComponent(regulation)}&from=${from}&to=${to}`,
    ),

  ingest: (req: IngestRequest) =>
    call<IngestResponse>("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req),
    }),
};
```
