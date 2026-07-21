import { useState } from "react";
import {
  regshield,
  ENTITY_TYPES,
  type EntityType,
  type QueryResponse,
} from "../lib/api";

const EXAMPLES = [
  "We onboard customers with Aadhaar OTP-based e-KYC. What is the credit ceiling and the CDD deadline?",
  "What are the periodic KYC updation timelines?",
  "When must CKYCR records be uploaded after account opening?",
];

export default function QueryPanel() {
  const [text, setText] = useState("");
  const [entityType, setEntityType] = useState<EntityType>("NBFC");
  const [regulation, setRegulation] = useState("KYC_Master_Direction");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QueryResponse | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!text.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await regshield.query({
        text: text.trim(),
        entity_type: entityType,
        regulation: regulation.trim() || undefined,
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card">
      <h2 className="card-title">Compliance query</h2>
      <p className="card-sub">
        Ask a natural-language question scoped to your entity type. Answers are
        drawn only from retrieved RBI clauses and mechanically validated — every
        ₹-amount or timeline must carry a citation.
      </p>

      <form onSubmit={submit}>
        <div className="row">
          <div className="field">
            <label htmlFor="entity">Entity type</label>
            <select
              id="entity"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
            >
              {ENTITY_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="reg">
              Regulation <span className="hint">(optional filter)</span>
            </label>
            <input
              id="reg"
              type="text"
              value={regulation}
              onChange={(e) => setRegulation(e.target.value)}
              placeholder="KYC_Master_Direction"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="q">Your question</label>
          <textarea
            id="q"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
            }}
            placeholder="e.g. What is the credit ceiling for Aadhaar OTP e-KYC accounts?"
          />
          <div className="chips">
            {EXAMPLES.map((ex) => (
              <button
                type="button"
                key={ex}
                className="chip"
                onClick={() => setText(ex)}
              >
                {ex.length > 52 ? ex.slice(0, 52) + "…" : ex}
              </button>
            ))}
          </div>
        </div>

        <div className="actions">
          <button className="primary" type="submit" disabled={loading || !text.trim()}>
            {loading ? "Analyzing…" : "Ask RegShield"}
          </button>
          {loading && (
            <span className="inline-load">
              <span className="spinner" />
              retrieving clauses & validating…
            </span>
          )}
          <span className="hint" style={{ marginLeft: "auto" }}>
            ⌘/Ctrl + ↵
          </span>
        </div>
      </form>

      {error && (
        <div className="result">
          <div className="alert error">{error}</div>
        </div>
      )}

      {result && <QueryResult result={result} />}
    </div>
  );
}

function QueryResult({ result }: { result: QueryResponse }) {
  return (
    <div className="result">
      <span className={`confidence ${result.confidence}`}>
        {result.confidence === "verified" ? "✓ Verified" : "⚠ Needs review"}
      </span>

      <p className="answer">{result.answer}</p>

      {result.warnings && result.warnings.length > 0 && (
        <div className="warnings">
          <strong>Guardrail warnings</strong>
          <ul>
            {result.warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="section-label">
        Citations {(result.citations || []).length > 0 && `(${(result.citations || []).length})`}
      </div>
      {(result.citations || []).length === 0 ? (
        <div className="empty">No clauses were cited for this answer.</div>
      ) : (
        (result.citations || []).map((c, i) => (
          <div className="citation" key={i}>
            <div className="citation-clause">{c.clause}</div>
            <div className="citation-meta">
              {c.applicable_to.map((a) => (
                <span className="tag" key={a}>
                  {a.replace(/_/g, " ")}
                </span>
              ))}
              <span className="tag date">updated {c.last_updated}</span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
