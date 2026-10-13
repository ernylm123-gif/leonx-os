/// <reference types="vitest/config" />
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// ------------------------------------------------------------------ Sürüm ve derleme kimliği
// Her derleme benzersiz bir kimlik alır. Kimlik uygulamaya gömülür ve /version.json olarak
// yayımlanır; açık uygulamalar sunucudaki kimliği kendi kimlikleriyle karşılaştırarak yeni
// sürümü algılar (bkz. src/lib/appVersion.ts).
function git(cmd: string): string | null {
  try {
    return execSync(`git ${cmd}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null
  } catch {
    return null
  }
}
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8')) as { version: string }
const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? git('rev-parse HEAD') ?? 'bilinmiyor'
const builtAt = new Date().toISOString()
const BUILD = {
  version: pkg.version,
  commit: commit.slice(0, 7),
  branch: process.env.VERCEL_GIT_COMMIT_REF ?? git('rev-parse --abbrev-ref HEAD') ?? 'bilinmiyor',
  /** production | preview | development | yerel */
  env: process.env.VERCEL_ENV ?? (process.env.NODE_ENV === 'production' ? 'yerel' : 'development'),
  builtAt,
  buildId: `${pkg.version}+${commit.slice(0, 7)}.${Date.parse(builtAt).toString(36)}`,
}

function versionFile(): Plugin {
  return {
    name: 'leonx-version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ ...BUILD }, null, 2) })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), versionFile()],
  define: {
    __LEONX_BUILD__: JSON.stringify(BUILD),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  build: {
    // Tailwind CSS v4 ile aynı alt sınır: iOS / iPadOS Safari 16.4+, Chrome 111+, Firefox 114+
    target: ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4'],
    // Üretimde kaynak haritası yayınlanmaz
    sourcemap: false,
    // Fontlar data: URI olarak gömülmez; CSP font-src 'self' ile uyumlu kalır
    assetsInlineLimit: (file) => (file.endsWith('.woff2') || file.endsWith('.woff') ? false : undefined),
    // Kütüphaneler ayrı parçalarda: uygulama güncellemelerinde tarayıcı önbelleği korunur
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'supabase', test: /node_modules[\\/]@supabase/, priority: 30 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom|scheduler)[\\/]/, priority: 20 },
            { name: 'motion', test: /node_modules[\\/](framer-motion|motion-dom|motion-utils)[\\/]/, priority: 10 },
          ],
        },
      },
    },
  },
})
