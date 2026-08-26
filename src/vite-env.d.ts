/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_KC_BASE_URL?: string;
  readonly VITE_KC_AUTH_MODE?: string;
  readonly VITE_KC_TOKEN?: string;
  readonly VITE_ORG_PACKAGE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
