#!/usr/bin/env node
/**
 * Yayın kapısı: production paketi yayımlanmadan önce çalışır (vercel.json → buildCommand, CI).
 * - Pakette gizli anahtar (sb_secret_, service_role JWT) varsa yayını durdurur.
 * - version.json yoksa veya paketteki derleme kimliğiyle eşleşmiyorsa yayını durdurur
 *   (aksi hâlde açık uygulamalar yeni sürümü algılayamaz).
 * Bulunan değerler asla yazdırılmaz; yalnızca dosya adı bildirilir.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

const dist = path.resolve(process.argv[2] ?? 'dist')
const problems = []
const files = []
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = path.join(d, f)
    if (statSync(p).isDirectory()) walk(p)
    else files.push(p)
  }
}
walk(dist)

const JWT = /eyJ[A-Za-z0-9_-]{8,}\.(eyJ[A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]{8,}/g
for (const f of files) {
  if (!/\.(js|mjs|html|json|css|txt|map|webmanifest)$/.test(f)) continue
  const text = readFileSync(f, 'utf8')
  const rel = path.relative(dist, f)
  if (/sb_secret_[A-Za-z0-9_-]{6,}/.test(text)) problems.push(`${rel}: Supabase gizli anahtarı (sb_secret_)`)
  for (const m of text.matchAll(JWT)) {
    try {
      const payload = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8'))
      if (payload?.role === 'service_role') problems.push(`${rel}: service_role anahtarı`)
    } catch {
      /* JWT değil */
    }
  }
  if (/\.map$/.test(f)) problems.push(`${rel}: kaynak haritası yayımlanmamalı`)
}

let build = null
try {
  build = JSON.parse(readFileSync(path.join(dist, 'version.json'), 'utf8'))
} catch {
  problems.push('version.json yok veya okunamıyor')
}
if (build) {
  if (typeof build.buildId !== 'string' || !build.buildId) problems.push('version.json: buildId eksik')
  else {
    const embedded = files.filter((f) => f.endsWith('.js')).some((f) => readFileSync(f, 'utf8').includes(build.buildId))
    if (!embedded) problems.push('version.json derleme kimliği uygulama paketinde bulunamadı')
  }
}

if (problems.length) {
  console.error('✗ Yayın kapısı: paket yayımlanamaz')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}
console.log(`✓ Yayın kapısı: ${files.length} dosya tarandı, gizli anahtar yok · derleme ${build.buildId} (${build.env})`)
