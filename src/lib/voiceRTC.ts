// useVoiceRTC — a self-contained WebRTC signaling hook for the RegShield Voice
// tab. Ported from Dograh's ui/.../hooks/useWebSocketRTC.tsx, with all
// Dograh-internal dependencies stripped: no generated SDK (no TURN fetch, no
// pre-flight validation calls), no AppConfigContext, console instead of the
// logger, and an inline getUserMedia (no device picker). STUN-only ICE, which
// is sufficient for same-machine / LAN dev.
//
// Flow on start():
//   1. POST bootstrapUrl (the voice-bridge)  -> { token, workflow_id, workflow_run_id }
//   2. open WS  ${wsBaseUrl}/api/v1/ws/signaling/{wf}/{run}?token={token}
//   3. getUserMedia(audio) -> RTCPeerConnection -> offer (ICE trickling)
//   4. render live transcript + confidence from the rtf-* feedback events that
//      arrive on the SAME socket.

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceStatus = "idle" | "connecting" | "connected" | "failed";
export type VoiceConfidence = "verified" | "needs_review";

export interface TranscriptMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  /** false = still streaming / interim; true = committed turn. */
  final: boolean;
}

interface UseVoiceRTCOptions {
  /** voice-bridge endpoint that mints a session, e.g. http://localhost:8787/voice/session */
  bootstrapUrl: string;
  /** Dograh base URL (http/https); the hook rewrites the scheme to ws/wss. */
  wsBaseUrl: string;
}

interface SessionBootstrap {
  token: string;
  workflow_id: number;
  workflow_run_id: number;
}

/**
 * The rtf-function-call-end `result` is a Python repr string, e.g.
 * "{'status': 'success', 'status_code': 200, 'data': {'answer': '...',
 * 'confidence': 'verified', ...}}" — NOT JSON. Naively swapping quotes breaks on
 * apostrophes in the answer text, so we just regex out the confidence flag,
 * which is all the badge needs.
 */
function parseConfidence(result: unknown): VoiceConfidence | null {
  if (typeof result !== "string") return null;
  const m = result.match(/["']confidence["']\s*:\s*["'](verified|needs_review)["']/);
  return (m?.[1] as VoiceConfidence) ?? null;
}

function secureId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return prefix + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function useVoiceRTC({ bootstrapUrl, wsBaseUrl }: UseVoiceRTCOptions) {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [isActive, setIsActive] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<TranscriptMessage[]>([]);
  const [confidence, setConfidence] = useState<VoiceConfidence | null>(null);

  const audioRef = useRef<HTMLAudioElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const pcIdRef = useRef<string>(secureId("PC-"));
  const gracefulRef = useRef(false);

  const stopLocalStream = useCallback(() => {
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
  }, []);

  const cleanup = useCallback(
    (opts: { graceful?: boolean; status?: VoiceStatus } = {}) => {
      const graceful = opts.graceful ?? true;
      gracefulRef.current = graceful;
      setIsActive(false);
      setStatus(opts.status ?? (graceful ? "idle" : "failed"));

      const ws = wsRef.current;
      if (ws && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
        ws.close();
      }
      wsRef.current = null;

      stopLocalStream();

      const pc = pcRef.current;
      if (pc) {
        pc.getSenders().forEach((s) => s.track?.stop());
        if (pc.signalingState !== "closed") pc.close();
        pcRef.current = null;
      }
    },
    [stopLocalStream]
  );

  const appendUserTranscription = useCallback((text: string, final: boolean) => {
    setMessages((prev) => {
      // Finalize any streaming agent turn, drop the previous interim user line.
      const finalized = prev.map((m, i) =>
        i === prev.length - 1 && m.role === "agent" && !m.final ? { ...m, final: true } : m
      );
      const withoutInterim = finalized.filter((m) => !(m.role === "user" && !m.final));
      return [...withoutInterim, { id: secureId("u-"), role: "user", text, final }];
    });
  }, []);

  const appendBotText = useCallback((text: string) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.role === "agent" && !last.final) {
        return [...prev.slice(0, -1), { ...last, text: `${last.text} ${text}`.trim() }];
      }
      return [...prev, { id: secureId("a-"), role: "agent", text, final: false }];
    });
  }, []);

  const finalizeBotText = useCallback(() => {
    setMessages((prev) => {
      const idx = prev.length - 1;
      const last = prev[idx];
      if (last && last.role === "agent" && !last.final) {
        const copy = [...prev];
        copy[idx] = { ...last, final: true };
        return copy;
      }
      return prev;
    });
  }, []);

  const handleMessage = useCallback(
    async (raw: string) => {
      let msg: { type: string; payload?: Record<string, unknown> };
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      const payload = (msg.payload ?? {}) as Record<string, unknown>;

      switch (msg.type) {
        case "answer": {
          const pc = pcRef.current;
          if (pc) {
            await pc.setRemoteDescription({ type: "answer", sdp: payload.sdp as string });
            setIsActive(true);
          }
          break;
        }
        case "ice-candidate": {
          const c = payload.candidate as
            | { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null }
            | null;
          if (c && pcRef.current) {
            try {
              await pcRef.current.addIceCandidate({
                candidate: c.candidate,
                sdpMid: c.sdpMid,
                sdpMLineIndex: c.sdpMLineIndex,
              });
            } catch (e) {
              console.error("addIceCandidate failed", e);
            }
          }
          break;
        }
        case "error": {
          setError((payload.message as string) || "Voice service error");
          cleanup({ graceful: false, status: "failed" });
          break;
        }
        case "call-ended":
          cleanup({ graceful: true, status: "idle" });
          break;

        case "rtf-user-transcription":
          appendUserTranscription((payload.text as string) || "", Boolean(payload.final));
          break;
        case "rtf-bot-text":
          appendBotText((payload.text as string) || "");
          break;
        case "rtf-bot-stopped-speaking":
          finalizeBotText();
          break;
        case "rtf-function-call-end": {
          const parsed = parseConfidence(payload.result);
          if (parsed) setConfidence(parsed);
          break;
        }
        default:
          // rtf-node-transition / rtf-ttfb-metric / speaking + mute signals: ignored in v1.
          break;
      }
    },
    [appendBotText, appendUserTranscription, cleanup, finalizeBotText]
  );

  const openSocket = useCallback(
    (session: SessionBootstrap) =>
      new Promise<void>((resolve, reject) => {
        const wsUrl =
          `${wsBaseUrl.replace(/^http/, "ws")}/api/v1/ws/signaling/` +
          `${session.workflow_id}/${session.workflow_run_id}?token=${session.token}`;
        const ws = new WebSocket(wsUrl);
        ws.onopen = () => {
          wsRef.current = ws;
          resolve();
        };
        ws.onerror = () => reject(new Error("Could not reach the voice service."));
        ws.onclose = (ev) => {
          wsRef.current = null;
          if (ev.reason === "call ended") {
            cleanup({ graceful: true, status: "idle" });
          } else if (isActive && !gracefulRef.current) {
            setStatus("failed");
          }
        };
        ws.onmessage = (ev) => void handleMessage(ev.data as string);
      }),
    [wsBaseUrl, cleanup, handleMessage, isActive]
  );

  const createPeerConnection = useCallback(() => {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: ["stun:stun.l.google.com:19302"] }],
    });

    pc.addEventListener("icecandidate", (event) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "ice-candidate",
            payload: {
              candidate: event.candidate
                ? {
                    candidate: event.candidate.candidate,
                    sdpMid: event.candidate.sdpMid,
                    sdpMLineIndex: event.candidate.sdpMLineIndex,
                  }
                : null,
              pc_id: pcIdRef.current,
            },
          })
        );
      }
    });

    const onStateChange = () => {
      if (
        pc.connectionState === "connected" ||
        pc.iceConnectionState === "connected" ||
        pc.iceConnectionState === "completed"
      ) {
        setStatus("connected");
      } else if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
        cleanup({ graceful: false, status: "failed" });
      } else if (
        pc.connectionState === "closed" ||
        pc.connectionState === "disconnected" ||
        pc.iceConnectionState === "disconnected"
      ) {
        cleanup({ graceful: true, status: "idle" });
      }
    };
    pc.addEventListener("iceconnectionstatechange", onStateChange);
    pc.addEventListener("connectionstatechange", onStateChange);

    pc.addEventListener("track", (evt) => {
      if (evt.track.kind === "audio" && audioRef.current) {
        audioRef.current.srcObject = evt.streams[0];
      }
    });

    pcRef.current = pc;
    return pc;
  }, [cleanup]);

  const negotiate = useCallback(
    async (pc: RTCPeerConnection, session: SessionBootstrap) => {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdp = pc.localDescription?.sdp;
      if (!sdp || wsRef.current?.readyState !== WebSocket.OPEN) return;
      wsRef.current.send(
        JSON.stringify({
          type: "offer",
          payload: {
            sdp,
            type: "offer",
            pc_id: pcIdRef.current,
            workflow_id: session.workflow_id,
            workflow_run_id: session.workflow_run_id,
            call_context_vars: {},
          },
        })
      );
    },
    []
  );

  const start = useCallback(async () => {
    if (isStarting) return;
    setIsStarting(true);
    setError(null);
    setConfidence(null);
    setMessages([]);
    gracefulRef.current = false;
    pcIdRef.current = secureId("PC-");
    setIsActive(false);
    setStatus("connecting");

    try {
      const resp = await fetch(bootstrapUrl, { method: "POST" });
      if (!resp.ok) {
        throw new Error(
          `Could not start a voice session (${resp.status}). Is the voice-bridge running?`
        );
      }
      const session = (await resp.json()) as SessionBootstrap;

      await openSocket(session);

      const pc = createPeerConnection();
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Microphone access is required for voice. Please allow it and retry.");
        cleanup({ graceful: false, status: "failed" });
        return;
      }
      stopLocalStream();
      localStreamRef.current = stream;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      await negotiate(pc, session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start voice.");
      cleanup({ graceful: false, status: "failed" });
    } finally {
      setIsStarting(false);
    }
  }, [
    bootstrapUrl,
    isStarting,
    openSocket,
    createPeerConnection,
    negotiate,
    cleanup,
    stopLocalStream,
  ]);

  const stop = useCallback(() => cleanup({ graceful: true, status: "idle" }), [cleanup]);

  // Release mic / sockets on unmount.
  useEffect(() => {
    return () => {
      stopLocalStream();
      wsRef.current?.close();
      pcRef.current?.close();
    };
  }, [stopLocalStream]);

  return {
    audioRef,
    start,
    stop,
    status,
    isActive,
    isStarting,
    error,
    messages,
    confidence,
  };
}
