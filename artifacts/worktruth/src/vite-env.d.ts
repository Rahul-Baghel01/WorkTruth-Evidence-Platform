/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Absolute origin of the deployed API (e.g. https://worktruth-api.onrender.com).
   * Unset in local development, where API calls stay relative and go through
   * the Vite dev proxy. Public value — never place a secret in a VITE_* var.
   */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
