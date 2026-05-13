interface ImportMetaEnv {
  VITE_SYNC_URL?: string;
  VITE_ACL_URL?: string;
  VITE_AUTH_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace JSX {
  interface IntrinsicElements {
    [elementName: string]: unknown;
  }
}
