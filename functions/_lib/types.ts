export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  DUANOS_KV: KVNamespaceLike;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  GOOGLE_SPREADSHEET_ID: string;
  ALLOWED_GOOGLE_EMAIL: string;
  SESSION_ENCRYPTION_KEY: string;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

export interface StoredSession {
  email: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

export type PagesHandler = (context: { request: Request; env: Env }) => Promise<Response>;
