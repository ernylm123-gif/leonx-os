import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Tailwind CSS v4 ile aynı alt sınır: iOS / iPadOS Safari 16.4+, Chrome 111+, Firefox 114+
    target: ['chrome111', 'edge111', 'firefox114', 'safari16.4', 'ios16.4'],
    // Üretimde kaynak haritası yayınlanmaz
    sourcemap: false,
    // Fontlar data: URI olarak gömülmez; CSP font-src 'self' ile uyumlu kalır
    assetsInlineLimit: (file) => (file.endsWith('.woff2') || file.endsWith('.woff') ? false : undefined),
  },
})
