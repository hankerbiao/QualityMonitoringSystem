export const API_BASE_URL = '/api';

export const OA_LOGIN_BASE_URL = 'http://tl.cooacloud.com/springboard_v3/login_proxy';
export const OA_APP_NAME = 'buqualiboard';

export const TOKEN_KEYS = {
  ACCESS: 'qualiboard-access-token',
  REFRESH: 'qualiboard-session-token',
  EXPIRY: 'qualiboard-token-expiry',
} as const;

export const VOICE_WS_URL = `wss://${location.host}/ws-voice`;
export const SAMPLE_RATE = 16000;
export const BUFFER_SIZE = 4096;
export const VOICE_STOP_WAIT = 2000;
