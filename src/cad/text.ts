/**
 * DXF metin temizleme: TEXT özel kodları (%%c, %%d, %%p) ve MTEXT biçim kodları
 * (\P, \f...;, \H...;, \S...; vb.) okunabilir düz metne çevrilir.
 */

export function cleanTextCodes(s: string): string {
  return s
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%(\d{3})/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/%%%/g, '%')
}

export function cleanMText(raw: string): string {
  let s = raw
  // Kaçışlı karakterleri geçici yer tutuculara al
  s = s.replace(/\\\\/g, '\u0001').replace(/\\\{/g, '\u0002').replace(/\\\}/g, '\u0003')
  s = s.replace(/\\P/g, '\n').replace(/\\~/g, ' ')
  // Yığılmış kesir / tolerans: \S1/2; \S1#2; \S+0.1^-0.2;
  s = s.replace(/\\S([^;]*?)([/#^])([^;]*);/g, (_, a: string, sep: string, b: string) => (sep === '^' ? `${a} ${b}`.trim() : `${a}/${b}`))
  // Parametreli biçim kodları: \f..; \F..; \H..; \h..; \C..; \c..; \T..; \Q..; \W..; \A..; \p..;
  s = s.replace(/\\[fFHhCcTQWApX][^;\\]*;/g, '')
  // Parametresiz anahtarlar: \L \l \O \o \K \k \N
  s = s.replace(/\\[LlOoKkN]/g, '')
  s = s.replace(/[{}]/g, '')
  s = s.replace(/\u0001/g, '\\').replace(/\u0002/g, '{').replace(/\u0003/g, '}')
  return cleanTextCodes(s)
}

/**
 * Ölçü metnindeki sayıyı okur. Türkçe çizimlerde ondalık ayırıcı virgül olabilir;
 * "1.250" gibi belirsiz yazımlar için tüm olası yorumlar döndürülür, seçim çağırana kalır.
 */
export function parseNumberCandidates(text: string): number[] {
  const m = /[-+]?\d[\d.,]*/.exec(text.replace(/\s+/g, ''))
  if (!m) return []
  const t = m[0].replace(/[.,]$/, '')
  const out = new Set<number>()
  const hasDot = t.includes('.')
  const hasComma = t.includes(',')
  if (!hasDot && !hasComma) out.add(Number(t))
  else if (hasDot && hasComma) {
    // Son ayırıcı ondalık kabul edilir
    const lastDot = t.lastIndexOf('.')
    const lastComma = t.lastIndexOf(',')
    if (lastComma > lastDot) out.add(Number(t.replace(/\./g, '').replace(',', '.')))
    else out.add(Number(t.replace(/,/g, '')))
  } else {
    const sep = hasDot ? '.' : ','
    const parts = t.split(sep)
    if (parts.length === 2) {
      out.add(Number(`${parts[0]}.${parts[1]}`))
      // "1.250" binlik ayırıcı da olabilir
      if (parts[1].length === 3) out.add(Number(parts[0] + parts[1]))
    } else if (parts.every((p, i) => i === 0 || p.length === 3)) {
      out.add(Number(parts.join('')))
    }
  }
  return [...out].filter((n) => Number.isFinite(n))
}
