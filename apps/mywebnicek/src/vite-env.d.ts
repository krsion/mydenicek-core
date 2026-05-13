/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SYNC_URL?: string;
  readonly VITE_AUTH_ENABLED?: string;
  readonly VITE_AUTH_CLIENT_ID?: string;
  readonly VITE_AUTH_TENANT_ID?: string;
  readonly VITE_AUTH_SCOPE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
