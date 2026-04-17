/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * GitHub Fine-grained PAT with `models:read` scope.
   * Set in `.env.local` (never commit this file).
   * Embedded at build time — do NOT put sensitive tokens here for public repos.
   */
  readonly VITE_GH_TOKEN?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
