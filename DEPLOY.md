# Deploying RegShield for free (no credit card)

Three free accounts, zero card. The heavy Python/Marker ingestion sidecar is **not**
deployed — you seed from the bundled text fixtures.

| Part | Host | Card? |
|------|------|-------|
| Vector DB (Qdrant) | [Qdrant Cloud](https://cloud.qdrant.io) free 1 GB | none |
| Go API | [Render](https://render.com) Web Service (free) | none |
| Frontend (this SPA) | Render Static Site (or Cloudflare Pages / Netlify) | none |
| Embeddings key | [Jina AI](https://jina.ai/embeddings) free 10M tokens | none |
| LLM key | [Groq](https://console.groq.com) free | none |

> Prereq: both repos (`regShield`, `regShield-frontend`) must be pushed to GitHub.
> The Go API needs the `QDRANT_API_KEY` patch (already applied to `internal/qdrant`
> + `internal/config`) so it can authenticate to a hosted Qdrant.

---

## 1. Qdrant Cloud (vector DB)

1. Sign up at <https://cloud.qdrant.io> (GitHub/Google login, no card).
2. **Create a free cluster** (1 GB, any region). Wait ~1 min for it to start.
3. Copy two things:
   - **Endpoint URL** — looks like `https://xxxx-xxxx.<region>.aws.cloud.qdrant.io:6333`
   - **API key** — create one under the cluster's **API Keys** / **Data Access Control**.
4. Keep it warm: free clusters auto-suspend after 1 week idle and delete after 4.

## 2. Groq + Jina keys

- Groq: <https://console.groq.com> → API Keys → create. → `GROQ_API_KEY`
- Jina: <https://jina.ai/embeddings> → get free key. → `JINA_API_KEY`

## 3. Go API on Render

1. <https://render.com> → sign up with GitHub (no card).
2. **New → Web Service** → connect the `regShield` repo.
3. Render auto-detects the `Dockerfile`. Runtime = Docker. Instance = **Free**.
4. Add environment variables:

   | Key | Value |
   |-----|-------|
   | `QDRANT_URL` | your Qdrant Cloud endpoint (incl. `:6333`) |
   | `QDRANT_API_KEY` | your Qdrant API key |
   | `JINA_API_KEY` | your Jina key |
   | `GROQ_API_KEY` | your Groq key |

5. Deploy. When live you get a URL like `https://regshield-api.onrender.com`.
   Verify: `curl https://regshield-api.onrender.com/health` → `{"status":"ok"}`.
   (Free instances sleep after 15 min idle; first request after that takes ~1 min.)

## 4. Seed the data (one-time)

From your machine, point the seed script at the live API (needs `curl` + `jq`):

```bash
cd ../regShield
API_URL=https://regshield-api.onrender.com scripts/seed.sh
```

This ingests both dated KYC fixtures into Qdrant Cloud. Re-run only if the cluster
is ever wiped (e.g. after a 4-week suspension). Sanity check:

```bash
API_URL=https://regshield-api.onrender.com scripts/demo.sh
```

## 5. Frontend on Render (Static Site)

1. Render → **New → Static Site** → connect the `regShield-frontend` repo.
2. Settings:
   - **Build command:** `npm install && npm run build`
   - **Publish directory:** `dist`
3. Add environment variable:

   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://regshield-api.onrender.com` |

4. Deploy → you get `https://regshield.onrender.com`. Done.

> `VITE_*` vars are baked in at build time, so a change to `VITE_API_URL` needs a
> redeploy — not just a restart.

### Alternative frontend hosts (also no card)

- **Cloudflare Pages** — connect repo, build `npm run build`, output `dist`, set
  `VITE_API_URL` env var. Fastest CDN, no cold starts.
- **Netlify** — same three settings. `netlify deploy` CLI works too.

---

## Why it works out of the box

- The Go API sends `Access-Control-Allow-Origin: *`, so the browser SPA can call it
  cross-origin with no proxy.
- Secrets (Groq/Jina/Qdrant keys) live only in the Render **API** service env — never
  shipped to the browser. The frontend only ever knows `VITE_API_URL`.

## Gotchas

- **Cold starts:** the free Render API sleeps after 15 min. The first `/query` after
  idle waits ~1 min for wake **plus** the LLM call. The health badge will flip to
  "offline" during wake, then recover.
- **Qdrant suspension:** touch the app at least weekly, or re-seed after a wipe.
- **Changed `VITE_API_URL`?** Trigger a frontend redeploy — it's compile-time.
