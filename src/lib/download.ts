/** Tarayıcıda dosya indirme (iPad/iPhone Safari dahil: bağlantı tıklaması ile) */
export function downloadBytes(bytes: Uint8Array, name: string, type: string) {
  const blob = new Blob([bytes as BlobPart], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export async function fetchBytes(url: string): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url} yüklenemedi`)
  return new Uint8Array(await res.arrayBuffer())
}

/** PDF çıktısı için gömülü yazı tipleri ve logo (yalnızca gerektiğinde yüklenir) */
export async function loadPdfAssets(): Promise<{ regular: Uint8Array; semibold: Uint8Array; logo: Uint8Array | null }> {
  const [reg, semi] = await Promise.all([import('@/assets/fonts/Inter-Regular.ttf?url'), import('@/assets/fonts/Inter-SemiBold.ttf?url')])
  const [regular, semibold, logo] = await Promise.all([fetchBytes(reg.default), fetchBytes(semi.default), fetchBytes('/branding/leonx-logo.png').catch(() => null)])
  return { regular, semibold, logo }
}
