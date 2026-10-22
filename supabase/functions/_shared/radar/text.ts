/**
 * LEONX Radar — Türkçe metin yardımcıları (bağımlılıksız; Deno ve Vitest ortak kullanır).
 *
 * Eşleştirme için metin "katlanır": tr-TR küçük harf (İ/ı ayrımı korunarak küçültme),
 * ardından ş→s, ç→c, ğ→g, ö→o, ü→u, ı→i, â/î/û → a/i/u. Böylece "YANGIN KAPISI",
 * "yangın kapısı" ve "yangin kapisi" aynı biçime iner.
 */

const FOLD_MAP: Record<string, string> = {
  ş: 's', ç: 'c', ğ: 'g', ö: 'o', ü: 'u', ı: 'i', â: 'a', î: 'i', û: 'u', é: 'e', è: 'e', ê: 'e', á: 'a', à: 'a', ô: 'o', ë: 'e', ä: 'a',
}

/** Türkçe küçük harfe çevirip aksanları katlar. Kesme işaretleri silinir ("Ankara'da" → "ankarada"). */
export function fold(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/̇/g, '')
    .replace(/[şçğöüıâîûéèêáàôëä]/g, (c) => FOLD_MAP[c] ?? c)
    .replace(/['’`´]/g, '')
}

/** Katlanmış sözcük listesi (harf ve rakam dizileri) */
export function foldTokens(s: string): string[] {
  return fold(s).split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * Türkçe çekim ekleri (katlanmış biçimde). Gövdeden sonra yalnız bu ekler gelebilir;
 * böylece "kapi" → "kapisi", "kapilarinin", "kapida" eşleşir ama "kapital" eşleşmez.
 */
const SUFFIX_RE = new RegExp(
  '^' +
    '(?:y|n|s)?' +
    '(?:li|lu)?' +
    '(?:lar|ler)?' +
    '(?:i|u|a|e|in|un|im|um|imiz|umuz|iniz|unuz|si|su|leri|lari)?' +
    '(?:n)?' +
    '(?:in|un|i|u|a|e|da|de|ta|te|dan|den|tan|ten|la|le|ki|nin|nun|ya|ye|yla|yle|na|ne|nda|nde|ndan|nden|daki|deki|ndaki|ndeki|taki|teki)?' +
    '$',
)

/** Sözcük, gövde + izinli Türkçe ek mi? */
export function stemMatches(token: string, stem: string): boolean {
  if (!token.startsWith(stem)) return false
  const rest = token.slice(stem.length)
  if (!rest) return true
  if (rest.length > 9) return false
  return SUFFIX_RE.test(rest)
}

/**
 * Katlanmış sözcük dizisinde bir ifadeyi (bir veya birkaç gövde) arar. Her gövde sırayla ardışık
 * sözcüklere çekim ekiyle eşleşmelidir. Eşleşen ilk konumu döndürür; yoksa -1.
 */
export function findPhrase(tokens: string[], phrase: string[]): number {
  if (!phrase.length) return -1
  outer: for (let i = 0; i + phrase.length <= tokens.length; i++) {
    for (let j = 0; j < phrase.length; j++) {
      if (!stemMatches(tokens[i + j], phrase[j])) continue outer
    }
    return i
  }
  return -1
}

/** Anahtar ifadeyi gövde dizisine çevirir ("Yangın kapısı" → ["yangin","kapisi"]) */
export function phraseOf(keyword: string): string[] {
  return foldTokens(keyword)
}

/** Ardışık boşlukları teke indirir, baş/son boşluğu siler */
export function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Metni en çok n karaktere kısaltır (kesilirse "…") */
export function clip(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, Math.max(0, n - 1)).trimEnd() + '…'
}
