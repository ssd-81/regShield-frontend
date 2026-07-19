import { useVoiceRTC, type VoiceStatus } from "../lib/voiceRTC";

// Where the Dograh signaling WS lives, and where the voice-bridge mints sessions.
const WS_BASE_URL = import.meta.env.VITE_DOGRAH_WS_URL ?? "http://localhost:8000";
const BOOTSTRAP_URL =
  import.meta.env.VITE_VOICE_BOOTSTRAP_URL ?? "http://localhost:8787/voice/session";

const STATUS_LABEL: Record<VoiceStatus, string> = {
  idle: "Idle",
  connecting: "Connecting…",
  connected: "Live",
  failed: "Disconnected",
};

export default function VoicePanel() {
  const { audioRef, start, stop, status, isActive, isStarting, error, messages, confidence } =
    useVoiceRTC({ bootstrapUrl: BOOTSTRAP_URL, wsBaseUrl: WS_BASE_URL });

  const primaryLabel = isActive
    ? "End call"
    : isStarting || status === "connecting"
      ? "Connecting…"
      : status === "failed"
        ? "Retry call"
        : "Start voice call";

  return (
    <div className="card">
      <div className="voice-head">
        <div>
          <h2 className="card-title">Compliance query — by voice</h2>
          <p className="card-sub">
            Speak a compliance question and hear a grounded answer. The voice agent
            answers only from RegShield's retrieved RBI clauses — every spoken figure or
            timeline comes from the same guardrail-validated <code>/query</code> the text
            tab uses.
          </p>
        </div>
        <span className={`voice-status voice-status-${status}`}>
          <span className="voice-dot" />
          {STATUS_LABEL[status]}
        </span>
      </div>

      <div className="actions">
        <button
          className="primary"
          type="button"
          onClick={isActive ? stop : start}
          disabled={isStarting || status === "connecting"}
        >
          {isActive ? "⏹ " : "🎙 "}
          {primaryLabel}
        </button>
        {confidence && (
          <span className={`confidence ${confidence}`}>
            {confidence === "verified" ? "✓ Verified" : "⚠ Needs review"}
          </span>
        )}
      </div>

      {error && (
        <div className="result">
          <div className="alert error">{error}</div>
        </div>
      )}

      <div className="section-label">Transcript</div>
      {messages.length === 0 ? (
        <div className="empty">
          {isActive
            ? "Listening… ask about KYC, credit ceilings, CDD timelines, or a regulation."
            : "Start a call and your conversation will appear here."}
        </div>
      ) : (
        <div className="voice-transcript">
          {messages.map((m) => (
            <div key={m.id} className={`voice-bubble voice-${m.role}${m.final ? "" : " interim"}`}>
              <span className="voice-role">{m.role === "user" ? "You" : "RegShield"}</span>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Remote TTS audio — the hook binds the agent's audio track to this element. */}
      <audio ref={audioRef} autoPlay playsInline className="voice-audio" />
    </div>
  );
}
