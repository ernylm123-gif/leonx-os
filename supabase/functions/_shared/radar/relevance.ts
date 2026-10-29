/**
 * LEONX Radar — ilgililik kapısı. Otomatik kaynaklardan gelen her öğe, fırsat olarak yazılmadan önce
 * buradan geçer. Belediye/kurum ilan sayfaları araç satışı, kiralama, yemek, temizlik gibi LEONX ile
 * ilgisiz ilanlarla doludur; bunlar fırsat listesine girmez, yalnız çalıştırma kaydında ret nedeniyle sayılır.
 *
 * Kabul:
 *  - Ürün eşleşmesi (doğrama, cam, cephe, korkuluk, çelik/yangın/oda kapısı, metal imalat…) → doğrulanmış
 *    (ilan) veya potansiyel (haber) ihtiyaç olarak kabul.
 *  - Ürün geçmiyor ama proje türü (okul, hastane, konut…) VE yapım/onarım işareti var → yalnız potansiyel.
 * Ret nedenleri sabit kodlardır (arayüz ve raporlar bunları sayar).
 * Elle eklenen öğeler bu kapıdan geçmez (sahibin kararıdır).
 */
import type { Classification } from './classify.ts'
import { fold } from './text.ts'

export type RejectReason = 'urun_yok' | 'insaat_disi' | 'tamamlanmis' | 'kapsam_disi_alim'

export const REJECT_LABEL: Record<RejectReason, string> = {
  urun_yok: 'LEONX ürünü veya yapım işi geçmiyor',
  insaat_disi: 'Satış / kiralama / hizmet ilanı (yapım değil)',
  tamamlanmis: 'Proje tamamlanmış',
  kapsam_disi_alim: 'Mal/hizmet alımı, LEONX ürünü yok',
}

/** Yapım/onarım işi işaretleri (katlanmış önek) */
const CONSTRUCTION = [
  'yapim isi', 'yapim ihale', 'yapimi isi', 'insaat', 'insaa', 'bina yapim', 'tadilat', 'onarim', 'bakim onarim', 'restorasyon',
  'guclendirme', 'yenileme isi', 'kentsel donusum', 'konut projesi', 'ek bina', 'ek derslik', 'hizmet binasi yapim', 'kaba yapi',
  'ince isler', 'ince insaat', 'anahtar teslim', 'taseron', 'alt yuklenici', 'tedarikci basvuru', 'teklif davet',
]

/** Yapım dışı ilan işaretleri: bunlar ürün de geçmiyorsa reddedilir */
const NON_CONSTRUCTION = [
  'kiralama', 'kiraya veril', 'kira ihale', 'satis ilan', 'satis ihale', 'satilacak', 'satisi', 'arac alim', 'arac kiralama', 'hurda',
  'yemek', 'catering', 'temizlik hizmet', 'guvenlik hizmet', 'personel hizmet', 'akaryakit', 'kirtasiye', 'ilac', 'tibbi sarf',
  'kantin', 'otopark isletme', 'reklam', 'sigorta', 'bilet', 'ekmek', 'sut', 'yem ', 'yem kirma', 'tohum', 'fidan', 'kat karsiligi',
]

/** Bina işareti (yol/asfalt/kanalizasyon gibi altyapı yapım işlerini ayırmak için) */
const BUILDING = ['bina', 'blok', 'konut', 'daire', 'tesis', 'merkez', 'salon', 'derslik', 'lojman', 'yurt', 'kres', 'cephe', 'pencere', 'kapi', 'dograma']

function hasAny(text: string, list: string[]): string | null {
  // Sözcük başı eşleşmesi (önek): "sut" → "sut", "sutu"; "kosut" değil
  for (const p of list) if (text.includes(` ${p.trim()}`)) return p.trim()
  return null
}

export interface RelevanceResult {
  keep: boolean
  reason: RejectReason | null
}

export function relevance(c: Classification, title: string, summary: string): RelevanceResult {
  const text = ` ${fold(`${title} ${summary}`).replace(/[^a-z0-9]+/g, ' ')} `
  const direct = c.categories.some((x) => x.reason === 'ihale_urun' || x.reason === 'haber_urun')
  if (direct) return { keep: true, reason: null }
  if (c.stage === 'tamamlandi') return { keep: false, reason: 'tamamlanmis' }
  const nonConstruction = hasAny(text, NON_CONSTRUCTION)
  const construction = hasAny(text, CONSTRUCTION)
  if (nonConstruction && !construction) return { keep: false, reason: 'insaat_disi' }
  if (c.projectType && (construction || c.stage === 'yapim' || c.stage === 'planlama')) return { keep: true, reason: null }
  if (construction && hasAny(text, BUILDING)) return { keep: true, reason: null }
  if (c.isProcurement) return { keep: false, reason: 'kapsam_disi_alim' }
  return { keep: false, reason: 'urun_yok' }
}
