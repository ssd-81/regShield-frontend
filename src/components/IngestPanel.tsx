import { useState } from "react";
import { regshield, type IngestResponse } from "../lib/api";

export default function IngestPanel() {
  const [markdown, setMarkdown] = useState("");
  const [version, setVersion] = useState("");
  const [regulation, setRegulation] = useState("KYC_Master_Direction");
  const [lastUpdated, setLastUpdated] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IngestResponse | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!markdown.trim() || !version.trim() || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await regshield.ingest({
        markdown,
        version: version.trim(),
        regulation: regulation.trim() || undefined,
        last_updated: lastUpdated.trim() || undefined,
        source_url: sourceUrl.trim() || undefined,
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
      <h2 className="card-title">Ingest a regulation version</h2>
      <p className="card-sub">
        Admin utility — paste a regulation’s markdown and tag it with a version.
        RegShield chunks it at the clause level, embeds each clause, and upserts
        into the vector store under{" "}
        <code className="inline">(regulation, version)</code>.
      </p>

      <form onSubmit={submit}>
        <div className="row">
          <div className="field">
            <label htmlFor="ing-reg">Regulation</label>
            <input
              id="ing-reg"
              type="text"
              value={regulation}
              onChange={(e) => setRegulation(e.target.value)}
              placeholder="KYC_Master_Direction"
            />
          </div>
          <div className="field">
            <label htmlFor="ing-ver">
              Version <span className="hint">(required)</span>
            </label>
            <input
              id="ing-ver"
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="2024-11-06"
            />
          </div>
        </div>

        <div className="row">
          <div className="field">
            <label htmlFor="ing-updated">
              Last updated <span className="hint">(optional)</span>
            </label>
            <input
              id="ing-updated"
              type="text"
              value={lastUpdated}
              onChange={(e) => setLastUpdated(e.target.value)}
              placeholder="2024-11-06"
            />
          </div>
          <div className="field">
            <label htmlFor="ing-src">
              Source URL <span className="hint">(optional)</span>
            </label>
            <input
              id="ing-src"
              type="text"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://rbidocs.rbi.org.in/…"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="ing-md">Regulation markdown</label>
          <textarea
            id="ing-md"
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="# Master Direction — Know Your Customer&#10;&#10;Section 16 V-CIP (Video based Customer Identification)&#10;…"
            style={{ minHeight: 220 }}
          />
        </div>

        <div className="actions">
          <button
            className="primary"
            type="submit"
            disabled={loading || !markdown.trim() || !version.trim()}
          >
            {loading ? "Ingesting…" : "Ingest & embed"}
          </button>
          {loading && (
            <span className="inline-load">
              <span className="spinner" />
              chunking, embedding & upserting…
            </span>
          )}
        </div>
      </form>

      {error && (
        <div className="result">
          <div className="alert error">{error}</div>
        </div>
      )}

      {result && (
        <div className="result">
          <span className="confidence verified">✓ Ingested</span>
          <div className="drift-summary" style={{ marginTop: 16 }}>
            <div className="stat added">
              <span className="num">{result.chunks_count}</span>
              <span className="lbl">clauses</span>
            </div>
            <div className="stat unchanged">
              <span className="num" style={{ fontSize: 15 }}>
                {result.regulation}
              </span>
              <span className="lbl">regulation</span>
            </div>
            <div className="stat unchanged">
              <span className="num" style={{ fontSize: 15 }}>
                {result.version}
              </span>
              <span className="lbl">version</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
