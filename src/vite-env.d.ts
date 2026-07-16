/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  /** Dograh base URL (http/https); the voice hook rewrites the scheme to ws/wss. */
  readonly VITE_DOGRAH_WS_URL?: string;
  /** voice-bridge session endpoint, e.g. http://localhost:8787/voice/session */
  readonly VITE_VOICE_BOOTSTRAP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
