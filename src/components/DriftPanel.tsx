import { useState } from "react";
import {
  regshield,
  type ChangeType,
  type DriftEntry,
  type DriftReport,
} from "../lib/api";

const ORDER: ChangeType[] = ["modified", "added", "removed", "unchanged"];

export default function DriftPanel() {
  const [regulation, setRegulation] = useState("KYC_Master_Direction");
  const [from, setFrom] = useState("2024-01-04");
  const [to, setTo] = useState("2024-11-06");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DriftReport | null>(null);

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!from.trim() || !to.trim() || loading) return;
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await regshield.drift(regulation.trim(), from.trim(), to.trim());
      setReport(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const counts = (report?.changes ?? []).reduce(
    (acc, c) => {
      acc[c.change_type] = (acc[c.change_type] ?? 0) + 1;
      return acc;
    },
    {} as Record<ChangeType, number>,
  );

  const sorted = [...(report?.changes ?? [])].sort(
    (a, b) => ORDER.indexOf(a.change_type) - ORDER.indexOf(b.change_type),
  );

  return (
    <div className="card">
      <h2 className="card-title">Regulation drift</h2>
      <p className="card-sub">
        Clause-level semantic diff between two dated versions of the same
        regulation. Compare <code className="inline">old</code> vs{" "}
        <code className="inline">new</code> text directly — a low similarity
        flags a substantive change.
      </p>

      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="drift-reg">Regulation</label>
          <input
            id="drift-reg"
            type="text"
            value={regulation}
            onChange={(e) => setRegulation(e.target.value)}
            placeholder="KYC_Master_Direction"
          />
        </div>
        <div className="row">
          <div className="field">
            <label htmlFor="from">
              From version <span className="hint">(older)</span>
            </label>
            <input
              id="from"
              type="text"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              placeholder="2024-01-04"
            />
          </div>
          <div className="field">
            <label htmlFor="to">
              To version <span className="hint">(newer)</span>
            </label>
            <input
              id="to"
              type="text"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              placeholder="2024-11-06"
            />
          </div>
        </div>

        <div className="actions">
          <button
            className="primary"
            type="submit"
            disabled={loading || !from.trim() || !to.trim()}
          >
            {loading ? "Diffing…" : "Compare versions"}
          </button>
          {loading && (
            <span className="inline-load">
              <span className="spinner" />
              aligning clauses…
            </span>
          )}
        </div>
      </form>

      {error && (
        <div className="result">
          <div className="alert error">{error}</div>
        </div>
      )}

      {report && (
        <div className="result">
          <div className="drift-summary">
            {ORDER.map((ct) => (
              <div className={`stat ${ct}`} key={ct}>
                <span className="num">{counts[ct] ?? 0}</span>
                <span className="lbl">{ct}</span>
              </div>
            ))}
          </div>

          {sorted.length === 0 ? (
            <div className="empty">No clauses reported for this comparison.</div>
          ) : (
            sorted.map((entry, i) => <DriftRow entry={entry} key={i} />)
          )}

          <p className="note">
            ⚠ The backend’s similarity threshold is lenient — substantive numeric
            edits (e.g. a ceiling change) can still score ~0.99 and read as{" "}
            <code className="inline">unchanged</code>. Expand a row and compare
            the text to be sure.
          </p>
        </div>
      )}
    </div>
  );
}

function DriftRow({ entry }: { entry: DriftEntry }) {
  const [open, setOpen] = useState(entry.change_type !== "unchanged");
  const hasBody = entry.old_text || entry.new_text;

  return (
    <div className="drift-entry">
      <div className="drift-head" onClick={() => hasBody && setOpen((o) => !o)}>
        <span className="drift-clause">
          <span className={`badge ${entry.change_type}`}>{entry.change_type}</span>
          {entry.clause}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {typeof entry.similarity === "number" && (
            <span className="sim">
              sim {(entry.similarity * 100).toFixed(1)}%
            </span>
          )}
          {hasBody && <span className={`caret ${open ? "open" : ""}`}>▶</span>}
        </span>
      </div>

      {open && hasBody && (
        <div className="drift-body">
          {entry.old_text && (
            <div className="diff-col">
              <div className="diff-label">Old — before</div>
              <div className="diff-text old">{entry.old_text}</div>
            </div>
          )}
          {entry.new_text && (
            <div className="diff-col">
              <div className="diff-label">New — after</div>
              <div className="diff-text new">{entry.new_text}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
