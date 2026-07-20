# RegShield API — Practical Build Plan (Golang)

**Goal:** A working backend that ingests real RBI Master Directions, chunks them at the clause level, stores them in Qdrant with fintech-specific metadata, and answers compliance queries with a citation-locked LLM guardrail — plus a "drift" endpoint that diffs two versions of the same regulation semantically.

---

## 0. Real source documents to use

Use the **KYC Master Direction** as the anchor document — it has a clean version history, which is exactly what the drift-mapping feature needs.

| Version | Date | Source |
|---|---|---|
| Base | Feb 25, 2016 | `DBR.AML.BC.No.81/14.01.001/2015-16` |
| Amendment | May 10, 2021 | V-CIP / Video KYC introduced |
| Amendment | Jan 04, 2024 | Risk categorisation updates |
| Amendment | Nov 06, 2024 | CKYCR upload timelines, UCIC-level CDD, PMLR/UAPA alignment |
| Amendment | Jun 12, 2025 / Aug 14, 2025 | Latest consolidated version |

Canonical RBI links to pull PDFs from:
- Master direction landing page: `https://website.rbi.org.in/en/web/rbi/-/notifications/master-direction-know-your-customer-kyc-direction-2016-updated-as-on-may-04-2023-lt-span-gt-11566`
- Direct PDF (base + consolidated, RBI re-issues this URL with each amendment, so re-download periodically): `https://rbidocs.rbi.org.in/rdocs/notification/PDFs/MD18KYCF6E92C82E1E1419D87323E3869BC9F13.PDF`
- Individual amendment notifications: search `rbi.org.in/Scripts/NotificationUser.aspx?Id=...` (each amendment has its own circular ID, e.g. `Id=12746` for the Nov 2024 one).

Grab **2-3 dated PDFs** (e.g. the Jan-2024 consolidated version and the Nov-2024 consolidated version) — RBI always republishes the *full* master direction with a new "Updated as on" date rather than issuing pure diffs, so each download is already a complete, self-consistent document. That's what makes drift-mapping tractable: same clause numbers, different text.

Real clauses to design around (confirmed from the actual document — use these as your test fixtures instead of synthetic text):
- `Paragraph 38` — periodic KYC updation
- Clause `(e)` / `(f)` under the CKYCR paragraph — individual vs. legal-entity upload deadlines
- `Rule 9(1C)` of the PML Rules — cross-reference to an external regulation (your parser needs to preserve these as **external citations**, not chunk boundaries)
- `Section 51A` UAPA order — sanctions screening
- `Paragraph 17`, sub-clauses `(i)–(viii)` — Aadhaar OTP-based e-KYC, non-face-to-face accounts, 1-year CDD completion deadline
- `Section 16` — V-CIP (Video-based Customer Identification), which is the one your example query ("₹1,50,000 loan, Aadhaar OTP e-KYC") will actually hit, since OTP-based e-KYC has a **statutory balance/credit ceiling** tied to it.

---

## 1. High-level architecture

```
                    ┌─────────────────────────────┐
   RBI PDFs  ─────► │  Python Ingestion Sidecar    │
  (2-3 versions)     │  (Marker / LlamaParse)       │
                    │  → structured Markdown/JSON   │
                    └───────────────┬──────────────┘
                                    │ HTTP POST (raw structured doc)
                                    ▼
                    ┌─────────────────────────────┐
                    │   Go Ingestion Service       │
                    │   - clause-level chunker      │
                    │   - metadata injector          │
                    │   - embedding client            │
                    └───────────────┬──────────────┘
                                    │ upsert (vector + payload)
                                    ▼
                    ┌─────────────────────────────┐
                    │        Qdrant (Docker)        │
                    │  collection: rbi_regulations   │
                    └───────────────┬──────────────┘
                                    │ filtered vector search
                                    ▼
                    ┌─────────────────────────────┐
                    │     Go Retrieval/API Layer     │
                    │  /query  /drift  /ingest       │
                    │  entity-type routing middleware│
                    │  guardrail prompt + validator   │
                    └───────────────┬──────────────┘
                                    │
                                    ▼
                            Product Manager / Client
```

**Why Python is in the loop at all:** Marker and LlamaParse are Python-only, and layout-aware PDF parsing (multi-column notification headers, nested tables, footnote-style amendment markers) is genuinely hard to reproduce in Go from scratch. Go owns everything after "give me structured text" — chunking, metadata, retrieval, guardrails, API. This is a one-time ingestion cost, not a runtime dependency, so it doesn't compromise the "Go backend" framing of the project.

---

## 2. Repo layout

```
regshield/
├── docker-compose.yml
├── go.mod
├── cmd/
│   └── server/main.go
├── internal/
│   ├── config/config.go
│   ├── models/
│   │   ├── chunk.go              # Chunk, Metadata structs
│   │   └── drift.go              # DriftReport structs
│   ├── chunker/
│   │   ├── clause_parser.go      # regex-based clause boundary detection
│   │   └── clause_parser_test.go # tested against real KYC MD excerpts
│   ├── embeddings/
│   │   └── client.go             # wraps embedding API (OpenAI/Voyage/local)
│   ├── qdrant/
│   │   ├── client.go             # thin REST wrapper (no heavy SDK dep)
│   │   └── collection.go         # schema + payload index setup
│   ├── retrieval/
│   │   └── hybrid_search.go      # vector search + metadata filter + keyword boost
│   ├── drift/
│   │   └── differ.go             # clause-aligned semantic diff between 2 versions
│   ├── guardrail/
│   │   ├── prompt.go             # strict system prompt template
│   │   └── validator.go          # post-hoc regex check: every ₹ / day figure must map to a clause id
│   ├── llm/
│   │   └── client.go             # LLM call wrapper (Anthropic/OpenAI)
│   └── api/
│       ├── router.go
│       ├── handlers_query.go
│       ├── handlers_ingest.go
│       └── handlers_drift.go
├── ingestion/                    # Python sidecar (separate deployable unit)
│   ├── requirements.txt
│   ├── parse.py                  # Marker/LlamaParse → structured JSON
│   └── download_rbi_docs.sh      # curls the RBI PDFs into ingestion/raw/
├── data/
│   ├── raw/                      # downloaded PDFs (gitignored)
│   ├── parsed/                   # Marker/LlamaParse output (gitignored)
│   └── fixtures/                 # small real-text snippets for unit tests
└── README.md
```

---

## 3. Ingestion layer (Python sidecar → Go)

### 3.1 Download

```bash
# ingestion/download_rbi_docs.sh
mkdir -p data/raw
curl -L -o data/raw/kyc_2024-01-04.pdf "https://rbidocs.rbi.org.in/rdocs/notification/PDFs/MD18KYCF6E92C82E1E1419D87323E3869BC9F13.PDF"
# repeat for each dated snapshot you can find via web.archive.org if RBI has overwritten the URL,
# since RBI republishes the SAME PDF filename with new content on each amendment —
# use the Wayback Machine CDX API to pull historical snapshots of that exact URL by date.
```

Practical note: RBI reuses the same PDF URL across amendments, so to get *multiple dated versions* of the same document you generally need the **Wayback Machine** (`web.archive.org/web/{timestamp}/{url}`) rather than RBI's live site, which only serves the current consolidated text. Document this clearly — it's the single biggest practical gotcha in this project.

### 3.2 Parse with Marker

```python
# ingestion/parse.py
from marker.converters.pdf import PdfConverter
from marker.models import create_model_dict
import json, sys, pathlib

def parse(pdf_path: str, out_path: str):
    converter = PdfConverter(artifact_dict=create_model_dict())
    rendered = converter(pdf_path)
    markdown_text = rendered.markdown
    pathlib.Path(out_path).write_text(markdown_text, encoding="utf-8")

if __name__ == "__main__":
    parse(sys.argv[1], sys.argv[2])
```

Marker preserves heading hierarchy (`#`, `##`) and numbered-list nesting reasonably well for Indian government PDFs, which is what lets the Go chunker below rely on structural markers rather than re-parsing raw PDF geometry. Output: one `.md` file per document version, named by its `last_updated` date (`kyc_2024-01-04.md`, `kyc_2024-11-06.md`).

Expose this as a tiny FastAPI/Flask endpoint (`POST /parse`) so the Go ingestion service can call it synchronously during `/ingest`, rather than running it as an ad hoc script — that's what makes this a real "layer" instead of a manual pre-processing step.

---

## 4. Chunking — clause-level anchoring (Go)

### 4.1 Clause boundary regex

Indian regulatory numbering is layered: `Chapter → Section/Paragraph → sub-clause (a),(b) → roman (i),(ii) → capital letter (A),(B)`. Detect boundaries at the **paragraph/section level** (not deeper) so each chunk is a self-contained regulatory unit, and keep sub-clauses as text *within* that chunk (their content is meaningless split apart from the parent clause).

```go
// internal/chunker/clause_parser.go
package chunker

import "regexp"

var clauseBoundary = regexp.MustCompile(
    `(?m)^(Chapter\s+[IVXLC]+.*|` +      // Chapter III
    `Section\s+\d+[A-Za-z]?\b.*|` +      // Section 16
    `Paragraph\s+\d+(\.\d+)*\b.*|` +     // Paragraph 38 / 38.2
    `Clause\s+\d+(\.\d+)*\b.*|` +        // Clause 14.2
    `\d+\.\d+(\.\d+)*\s+[A-Z].*)$`,      // 3.1.2 Small Accounts
)

type RawClause struct {
    Heading string
    Body    string
    StartOffset int
}

func SplitClauses(doc string) []RawClause {
    idxs := clauseBoundary.FindAllStringIndex(doc, -1)
    var out []RawClause
    for i, loc := range idxs {
        end := len(doc)
        if i+1 < len(idxs) {
            end = idxs[i+1][0]
        }
        block := doc[loc[0]:end]
        out = append(out, RawClause{
            Heading:     firstLine(block),
            Body:        block,
            StartOffset: loc[0],
        })
    }
    return out
}
```

Test this against the **real fixture text** from Section 3 above (`data/fixtures/kyc_para38.txt`, `data/fixtures/kyc_para17.txt`) instead of synthetic strings, e.g.:

```go
func TestSplitClauses_Paragraph38(t *testing.T) {
    doc := loadFixture(t, "kyc_para38.txt")
    clauses := SplitClauses(doc)
    require.Contains(t, clauses[0].Heading, "Paragraph 38")
    require.Contains(t, clauses[0].Body, "seven days")
}
```

### 4.2 Metadata injection

```go
// internal/models/chunk.go
type Metadata struct {
    Regulation    string   `json:"regulation"`       // "KYC_Master_Direction"
    Clause        string   `json:"clause"`           // "Section 16 (V-KYC)"
    LastUpdated   string   `json:"last_updated"`      // ISO date, from filename/version
    ApplicableTo  []string `json:"applicable_to"`     // ["NBFC","Payment_Bank","Mainstream_Bank"]
    SourceURL     string   `json:"source_url"`
    Version       string   `json:"version"`           // "2024-11-06"
    ExternalRefs  []string `json:"external_refs,omitempty"` // "PML Rules 9(1C)", "UAPA Section 51A"
}

type Chunk struct {
    ID       string    `json:"id"`
    Text     string    `json:"text"`
    Metadata Metadata  `json:"metadata"`
}
```

`ApplicableTo` tagging is where most of the real engineering effort goes — it isn't in the text explicitly. Build a small **rule table** (regex/keyword → entity types) since RBI documents mostly say "Regulated Entities" and only occasionally scope by type explicitly:

```go
var entityScopeRules = []struct {
    Pattern *regexp.Regexp
    Types   []string
}{
    {regexp.MustCompile(`(?i)non-banking financial compan|NBFC`), []string{"NBFC"}},
    {regexp.MustCompile(`(?i)payment(s)? bank`), []string{"Payment_Bank"}},
    {regexp.MustCompile(`(?i)scheduled commercial bank|\bbank(s)?\b`), []string{"Mainstream_Bank"}},
}
// default: if none match explicitly, tag all three — RBI's baseline scope is "all REs"
```

---

## 5. Storage — Qdrant + payload indexing (Go)

### 5.1 Collection schema

```go
// internal/qdrant/collection.go
// PUT /collections/rbi_regulations
{
  "vectors": { "size": 1536, "distance": "Cosine" },
  "payload_schema": {
    "metadata.applicable_to": "keyword",
    "metadata.clause": "keyword",
    "metadata.regulation": "keyword",
    "metadata.last_updated": "datetime"
  }
}
```

Create a **keyword index** on `metadata.applicable_to` explicitly (Qdrant needs this for fast filtered search at scale, not strictly required for a prototype but do it anyway — it's the whole point of section 3 of the spec).

### 5.2 Go Qdrant client (thin REST wrapper — no heavy SDK dependency)

```go
// internal/qdrant/client.go
package qdrant

func (c *Client) Upsert(ctx context.Context, collection string, points []Point) error {
    body, _ := json.Marshal(map[string]any{"points": points})
    req, _ := http.NewRequestWithContext(ctx, "PUT",
        fmt.Sprintf("%s/collections/%s/points", c.BaseURL, collection),
        bytes.NewReader(body))
    req.Header.Set("Content-Type", "application/json")
    resp, err := c.HTTP.Do(req)
    // ... handle resp
    return err
}

func (c *Client) Search(ctx context.Context, collection string, vector []float32,
    filter map[string]any, limit int) ([]ScoredPoint, error) {
    payload := map[string]any{
        "vector": vector, "limit": limit, "with_payload": true, "filter": filter,
    }
    // POST /collections/{collection}/points/search
}
```

Using raw REST instead of the official `qdrant-go` client keeps the module dependency-light and easy to build offline — worth doing for a prototype since the API surface you actually need (`upsert`, `search`, `scroll`) is tiny.

---

## 6. Retrieval — entity-type-filtered hybrid search (Go)

```go
// internal/retrieval/hybrid_search.go
func (s *Service) Query(ctx context.Context, q Query) ([]models.Chunk, error) {
    vec, err := s.Embedder.Embed(ctx, q.Text)
    filter := map[string]any{
        "must": []map[string]any{
            {"key": "metadata.applicable_to", "match": map[string]any{"value": q.EntityType}},
        },
    }
    if q.Regulation != "" {
        filter["must"] = append(filter["must"].([]map[string]any),
            map[string]any{"key": "metadata.regulation", "match": map[string]any{"value": q.Regulation}})
    }
    results, err := s.Qdrant.Search(ctx, "rbi_regulations", vec, filter, 5)
    // optional: re-rank top-K by BM25/keyword overlap on chunk.Text for numeric-term precision
    // (₹, "days", "months" tend to get diluted in pure embedding similarity)
    return toChunks(results), err
}
```

`entity_type` (`NBFC`, `Payment_Bank`, `Mainstream_Bank`) should come from the **API request**, not be inferred from the query text — a PM asking "can we do X" needs to tell the system what kind of entity "we" is, otherwise the filter is a guess.

---

## 7. Guardrails & response synthesis (Go)

### 7.1 System prompt

```go
// internal/guardrail/prompt.go
const SystemPrompt = `You are an expert compliance officer for Indian FinTechs.
Answer ONLY using the retrieved RBI clauses provided below. For every numeric
ceiling (₹ amount), timeline (days/months/years), or threshold mentioned in a
retrieved clause, you MUST:
1. State the exact figure verbatim (do not round or generalize).
2. Attach the exact clause identifier it came from (e.g. "Section 16, para (vii)").
3. If retrieved clauses do not directly answer the entity type or amount in
   the question, say so explicitly rather than extrapolating.
Do not answer using any knowledge outside the provided context.`
```

### 7.2 Post-hoc validator — this is the part that actually enforces precision

An LLM can still hedge even with a good prompt, so validate the *output* mechanically:

```go
// internal/guardrail/validator.go
var currencyRe = regexp.MustCompile(`₹[\d,]+`)
var timelineRe = regexp.MustCompile(`\b\d+\s+(day|days|month|months|year|years)\b`)
var clauseCiteRe = regexp.MustCompile(`(Section|Paragraph|Clause)\s+\d+`)

func Validate(answer string, retrievedClauseIDs []string) []string {
    var warnings []string
    if currencyRe.MatchString(answer) && !clauseCiteRe.MatchString(answer) {
        warnings = append(warnings, "numeric limit present without a clause citation")
    }
    // check any cited clause ID actually appears in the retrieved set,
    // to catch hallucinated section numbers
    for _, c := range clauseCiteRe.FindAllString(answer, -1) {
        if !contains(retrievedClauseIDs, c) {
            warnings = append(warnings, fmt.Sprintf("cited clause %q not in retrieved context", c))
        }
    }
    return warnings
}
```

If `Validate` returns warnings, the API returns `confidence: "needs_review"` alongside the answer instead of silently serving it — this is the actual "absolute precision" requirement made mechanical instead of just prompted.

---

## 8. Drift mapping (the differentiating feature)

Since each RBI download is a full consolidated document (not a diff), drift detection means: **align clauses by ID across two versions, then compare meaning, not just text.**

```go
// internal/drift/differ.go
type DriftEntry struct {
    Clause     string
    OldText    string
    NewText    string
    ChangeType string  // "added" | "removed" | "modified" | "unchanged"
    Similarity float64 // cosine sim between old/new embeddings
}

func Diff(oldChunks, newChunks []models.Chunk, embedder embeddings.Client) []DriftEntry {
    oldByClause := indexByClause(oldChunks)
    newByClause := indexByClause(newChunks)
    var report []DriftEntry
    for clause, newC := range newByClause {
        oldC, existed := oldByClause[clause]
        switch {
        case !existed:
            report = append(report, DriftEntry{Clause: clause, NewText: newC.Text, ChangeType: "added"})
        default:
            sim := cosine(embedder.Embed(oldC.Text), embedder.Embed(newC.Text))
            ct := "unchanged"
            if sim < 0.92 { ct = "modified" }  // threshold tuned empirically, start here
            report = append(report, DriftEntry{Clause: clause, OldText: oldC.Text, NewText: newC.Text,
                ChangeType: ct, Similarity: sim})
        }
    }
    for clause, oldC := range oldByClause {
        if _, ok := newByClause[clause]; !ok {
            report = append(report, DriftEntry{Clause: clause, OldText: oldC.Text, ChangeType: "removed"})
        }
    }
    return report
}
```

Expose as `GET /drift?regulation=KYC_Master_Direction&from=2024-01-04&to=2024-11-06` — this is the single most demo-able feature, e.g. it will correctly surface that the CKYCR upload deadline and UCIC-level CDD requirement are **new/modified** between those two dates.

---

## 9. API surface

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/ingest` | Trigger parse (calls Python sidecar) → chunk → embed → upsert |
| `POST` | `/query` | `{text, entity_type, regulation?}` → guardrailed answer + citations |
| `GET` | `/drift` | `{regulation, from, to}` → clause-level change report |
| `GET` | `/health` | liveness |

Example `/query` response:

```json
{
  "answer": "Yes, for individual accounts opened via Aadhaar OTP-based e-KYC in non-face-to-face mode, CDD must be completed within one year or the account is closed/frozen (Section 16, para vii). There is no explicit loan-amount ceiling tied specifically to OTP e-KYC in the retrieved clauses for NBFCs — recommend cross-checking the RE's own risk-based limit policy.",
  "confidence": "verified",
  "citations": [
    {"clause": "Section 16 (V-KYC), para (vii)", "last_updated": "2024-11-06", "applicable_to": ["NBFC"]}
  ]
}
```

---

## 10. docker-compose (local prototype)

```yaml
version: "3.9"
services:
  qdrant:
    image: qdrant/qdrant:latest
    ports: ["6333:6333"]
    volumes: ["./data/qdrant:/qdrant/storage"]
  ingestion:
    build: ./ingestion
    ports: ["8001:8001"]
  api:
    build: .
    ports: ["8080:8080"]
    environment:
      - QDRANT_URL=http://qdrant:6333
      - INGESTION_URL=http://ingestion:8001
      - LLM_API_KEY=${LLM_API_KEY}
    depends_on: [qdrant, ingestion]
```

---

## 11. Build order (practical, in sequence)

1. **Day 1** — `download_rbi_docs.sh` + Wayback Machine snapshots → 2-3 real dated PDFs in `data/raw/`.
2. **Day 1-2** — Python `parse.py` with Marker → structured `.md` per version. Sanity-check headings survived (`Section 16`, `Paragraph 38`, etc.).
3. **Day 2-3** — Go `clause_parser.go` + tests against real fixture snippets pulled from those `.md` files. This is the highest-risk part — budget the most time here.
4. **Day 3** — Metadata injector + entity-scope rule table.
5. **Day 4** — Qdrant docker-compose up, collection schema, `Upsert`/`Search` client, `/ingest` endpoint end-to-end on one document version.
6. **Day 5** — `/query` endpoint with entity-type filter, wire in LLM client + guardrail prompt + validator.
7. **Day 6** — Ingest the second/third version, build `/drift` endpoint, tune the similarity threshold against known real changes (CKYCR deadlines, UCIC CDD).
8. **Day 7** — Test suite pass on real fixtures, README, docker-compose smoke test, demo script (`curl` sequence showing ingest → query → drift).

---

## 12. Known practical gotchas

- **RBI overwrites its "current" PDF URL** — you cannot get historical versions from the live site; use Wayback Machine CDX API (`http://web.archive.org/cdx/search/cdx?url=rbidocs.rbi.org.in/...&output=json`) to enumerate snapshot timestamps.
- **Marker needs a GPU-friendly environment for speed** but runs on CPU fine for a handful of documents — don't over-provision for a prototype.
- **Cross-references to other Acts** (PML Rules, UAPA) should be tagged as `external_refs`, not chunked as if they were part of the KYC document — otherwise drift-mapping will falsely flag "changes" when it's really just a different citation format.
- **`applicable_to` is rarely explicit in the text** — treat the rule table as a first pass and expect to manually correct ~10-20% of chunks for a demo-quality dataset.
- **Numeric guardrail validator will have false positives** on legitimate qualitative answers (no threshold in that particular clause) — the check should be "if the model wrote a number, did it cite," not "every answer must contain a number."