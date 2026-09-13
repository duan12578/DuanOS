export interface KVNamespaceLike {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  DUANOS_KV: KVNamespaceLike;
  APPS_SCRIPT_WEB_APP_URL: string;
  APPS_SCRIPT_SHARED_SECRET: string;
  DUANOS_OWNER_PASSWORD_HASH: string;
}

export interface StoredSession { createdAt: number; expiresAt: number; }
export type PagesHandler = (context: { request: Request; env: Env }) => Promise<Response>;
