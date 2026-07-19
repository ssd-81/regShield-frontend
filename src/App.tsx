import { useState } from "react";
import HealthBadge from "./components/HealthBadge";
import QueryPanel from "./components/QueryPanel";
import DriftPanel from "./components/DriftPanel";
import IngestPanel from "./components/IngestPanel";
import VoicePanel from "./components/VoicePanel";

type Tab = "query" | "voice" | "drift" | "ingest";

const TABS: { id: Tab; label: string }[] = [
  { id: "voice", label: "🎙 Voice" },
  { id: "query", label: "Query" },
  { id: "drift", label: "Drift" },
  { id: "ingest", label: "Ingest" },
];

export default function App() {
  const [tab, setTab] = useState<Tab>("voice");

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-logo">
            <svg viewBox="0 0 24 24" fill="none">
              <path
                d="M12 2 4 5v6c0 5 3.4 8.5 8 11 4.6-2.5 8-6 8-11V5l-8-3Z"
                fill="#fff"
                fillOpacity="0.95"
              />
              <path
                d="m9 12 2 2 4-4"
                stroke="#4338ca"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <div>
            <h1>RegShield</h1>
            <p>RBI compliance copilot — citation-locked answers & regulation drift</p>
          </div>
        </div>
        <HealthBadge />
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`tab ${tab === t.id ? "active" : ""}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {tab === "query" && <QueryPanel />}
      {tab === "voice" && <VoicePanel />}
      {tab === "drift" && <DriftPanel />}
      {tab === "ingest" && <IngestPanel />}

      <footer className="footer">
        RegShield · answers are drawn only from ingested RBI clauses and validated
        by a mechanical guardrail — always cross-check against source before acting.
      </footer>
    </div>
  );
}
