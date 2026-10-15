/**
 * Bir PDF sayfasında OCR'ın NEREDE ve hangi çözünürlükte yapılacağı (tarayıcı ve testlerde ortak).
 *  - Taranmış sayfa veya bozuk yazı tipi: tüm sayfa, 250 dpi, seyrek metin
 *  - Çizgi olarak gömülü yazı (SHX): yalnız harf kümeleri, yazı yüksekliğine göre dpi, çizgi kalınlaştırma
 *  - Gömülü görüntü (çizelge olabilir): görüntü bölgesi, 300 dpi, blok (tablo) kipi
 */
import type { BBox } from '../geometry'
import type { PdfKind, TextGeometry } from './pdfScene'

export interface OcrRegionSpec {
  bbox: BBox
  vertical?: boolean
  mode?: 'seyrek' | 'blok'
  thicken?: boolean
}

/** Büyük harf yüksekliği ≈ 28 piksel olacak çözünürlük (200–450 dpi) */
export function dpiForTextHeight(heightPt: number | null | undefined): number {
  if (!heightPt || heightPt <= 0) return 300
  return Math.round(Math.max(200, Math.min(450, (28 / heightPt) * 72)))
}

export function ocrPlan(p: { kind: PdfKind | null; textGeometry?: TextGeometry | null; imageBoxes?: BBox[]; garbledText?: number }): { regions: OcrRegionSpec[] | 'sayfa'; dpi: number } {
  const scanned = p.kind === 'taranmis' || ((p.garbledText ?? 0) > 0.4 && !p.textGeometry)
  if (scanned) return { regions: 'sayfa', dpi: 250 }
  const regions: OcrRegionSpec[] = [
    ...(p.textGeometry?.regions ?? []).map((b) => ({ bbox: b, vertical: b[3] - b[1] > 2 * (b[2] - b[0]), mode: 'seyrek' as const, thicken: true })),
    ...(p.imageBoxes ?? []).filter((b) => b[2] - b[0] >= 80 && b[3] - b[1] >= 40).map((b) => ({ bbox: b, vertical: true, mode: 'blok' as const })),
  ]
  return { regions, dpi: p.textGeometry ? dpiForTextHeight(p.textGeometry.height) : 300 }
}
