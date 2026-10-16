/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string
  /** DWG dönüştürme servisi adresi (services/cad-worker); boşsa DWG için DXF'e dönüştürme rehberi gösterilir */
  readonly VITE_CAD_WORKER_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

/** Derleme bilgisi (vite.config.ts → define) */
declare const __LEONX_BUILD__: {
  version: string
  commit: string
  branch: string
  env: string
  builtAt: string
  buildId: string
}
