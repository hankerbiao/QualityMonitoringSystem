export const API_BASE_URL = '/api';

export const TOKEN_KEYS = {
  ACCESS: 'qualiboard-access-token',
  REFRESH: 'qualiboard-session-token',
  EXPIRY: 'qualiboard-token-expiry',
} as const;

export const VOICE_WS_URL = `wss://${location.host}/ws-voice`;
export const SAMPLE_RATE = 16000;
export const BUFFER_SIZE = 4096;
export const VOICE_STOP_WAIT = 2000;
