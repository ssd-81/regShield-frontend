# RegShield Frontend

A clean React + TypeScript SPA for the [RegShield](../regShield) Go API — an
RBI compliance copilot that gives citation-locked answers, diffs regulation
versions, and ingests new regulation text.

## Features

| Tab | Endpoint | What it does |
|-----|----------|--------------|
| **Query** | `POST /query` | Entity-scoped compliance Q&A. Shows the answer, a `verified` / `needs-review` confidence badge, guardrail warnings, and every clause citation. |
| **Drift** | `GET /drift` | Clause-level semantic diff between two dated versions. Counts added/removed/modified/unchanged and shows old-vs-new text side by side. |
| **Ingest** | `POST /ingest` | Admin utility to chunk, embed & upsert a regulation version from pasted markdown. |
| Health badge | `GET /health` | Live API online/offline indicator (polls every 15s). |

## Run it

The backend must be running first (see the `regShield` repo — `docker compose up`
then `scripts/seed.sh`). Then:

```bash
npm install
npm run dev          # http://localhost:5173
```

Point at a non-default backend with an env var:

```bash
echo 'VITE_API_URL=http://localhost:8080' > .env
```

## Build

```bash
npm run build        # type-checks (tsc) then bundles to dist/
npm run preview      # serve the production build
```

## Stack

Vite · React 18 · TypeScript (strict). No UI framework — a single hand-written
stylesheet (`src/styles.css`). The typed API client in `src/lib/api.ts` mirrors
the backend contract in [`API.md`](./API.md) exactly.
