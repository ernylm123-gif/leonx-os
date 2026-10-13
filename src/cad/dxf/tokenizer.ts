/**
 * ASCII DXF ayrıştırıcının ilk katmanı: bayt dizisini doğru karakter kodlamasıyla metne
 * çevirir ve (grup kodu, değer) çiftlerini satır satır üretir.
 *
 * Kodlama: AutoCAD 2007 (AC1021) ve sonrası UTF-8 yazar. Daha eski dosyalar $DWGCODEPAGE
 * ile belirtilen ANSI kod sayfasını kullanır (Türkçe çizimlerde genellikle ANSI_1254).
 * Önce geçerli UTF-8 olup olmadığına bakılır: eski sürüm etiketiyle UTF-8 yazan
 * programlar da vardır ve geçerli bir UTF-8 dizisi ANSI metinde neredeyse hiç oluşmaz.
 */

export class DxfSyntaxError extends Error {
  constructor(
    message: string,
    public readonly line: number,
  ) {
    super(`${message} (satır ${line})`)
    this.name = 'DxfSyntaxError'
  }
}

const CODEPAGES: Record<string, string> = {
  ANSI_874: 'windows-874',
  ANSI_932: 'shift_jis',
  ANSI_936: 'gbk',
  ANSI_949: 'euc-kr',
  ANSI_950: 'big5',
  ANSI_1250: 'windows-1250',
  ANSI_1251: 'windows-1251',
  ANSI_1252: 'windows-1252',
  ANSI_1253: 'windows-1253',
  ANSI_1254: 'windows-1254',
  ANSI_1255: 'windows-1255',
  ANSI_1256: 'windows-1256',
  ANSI_1257: 'windows-1257',
  ANSI_1258: 'windows-1258',
}

export interface DecodedDxf {
  text: string
  encoding: string
  /** Başlıktan okunan kod sayfası (varsa) */
  codepage: string | null
  acadver: string | null
  /** Yanlış etiketli kod sayfası düzeltildi mi (ANSI_1252 → 1254) */
  corrected: boolean
}

function headerValue(probe: string, name: string): string | null {
  // $NAME\n  <kod>\n<değer>
  const re = new RegExp(`\\$${name}\\s*\\r?\\n\\s*\\d+\\s*\\r?\\n([^\\r\\n]*)`)
  const m = re.exec(probe)
  return m ? m[1].trim() : null
}

export function decodeDxf(bytes: Uint8Array): DecodedDxf {
  const probe = new TextDecoder('windows-1252').decode(bytes.subarray(0, Math.min(bytes.length, 256 * 1024)))
  const acadver = headerValue(probe, 'ACADVER')
  const codepage = headerValue(probe, 'DWGCODEPAGE')
  let start = 0
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) start = 3
  const body = bytes.subarray(start)

  const modern = acadver != null && /^AC\d{4}$/.test(acadver) && Number(acadver.slice(2)) >= 1021
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(body)
    return { text, encoding: 'utf-8', codepage, acadver, corrected: false }
  } catch {
    if (modern) {
      // Bozuk UTF-8: değiştirme karakteriyle oku, uyarı analiz raporunda verilir
      return { text: new TextDecoder('utf-8').decode(body), encoding: 'utf-8 (hatalı baytlar)', codepage, acadver, corrected: false }
    }
  }
  const label = (codepage && CODEPAGES[codepage.toUpperCase()]) || 'windows-1254'
  let text: string
  try {
    text = new TextDecoder(label).decode(body)
  } catch {
    text = new TextDecoder('windows-1252').decode(body)
    return { text, encoding: 'windows-1252', codepage, acadver, corrected: false }
  }
  // Türkçe çizimler sıkça ANSI_1252 etiketiyle kaydedilir. 1252'de Ğ/Ş/İ/ğ/ş/ı yerine
  // Ð/Þ/Ý/ð/þ/ý görünür; bu harfler Batı Avrupa metinlerinde neredeyse hiç geçmez.
  if (label === 'windows-1252' && /[ÐÞÝðþý]/.test(text)) {
    return { text: new TextDecoder('windows-1254').decode(body), encoding: 'windows-1254', codepage, acadver, corrected: true }
  }
  return { text, encoding: label, codepage, acadver, corrected: false }
}

/** DXF metin kaçışları: \U+XXXX (Unicode) */
export function unescapeDxfString(s: string): string {
  if (s.indexOf('\\U+') === -1 && s.indexOf('\\u+') === -1) return s
  return s.replace(/\\[Uu]\+([0-9A-Fa-f]{4})/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
}

export interface Pair {
  code: number
  value: string
  line: number
}

/**
 * (grup kodu, değer) çiftlerini sırayla döndüren okuyucu. Bellek dostudur: tüm dosyayı
 * satır dizisine bölmez.
 */
export class PairReader {
  private pos = 0
  private lineNo = 0
  private peeked: Pair | null = null
  readonly length: number

  constructor(private readonly text: string) {
    this.length = text.length
  }

  /** İlerleme oranı (0..1) */
  get progress(): number {
    return this.length === 0 ? 1 : this.pos / this.length
  }

  private readLine(): string | null {
    if (this.pos >= this.text.length) return null
    let end = this.text.indexOf('\n', this.pos)
    if (end === -1) end = this.text.length
    let line = this.text.slice(this.pos, end)
    if (line.endsWith('\r')) line = line.slice(0, -1)
    this.pos = end + 1
    this.lineNo++
    return line
  }

  next(): Pair | null {
    if (this.peeked) {
      const p = this.peeked
      this.peeked = null
      return p
    }
    let codeLine = this.readLine()
    // Dosya sonundaki boş satırlar
    while (codeLine !== null && codeLine.trim() === '' && this.pos >= this.text.length) codeLine = this.readLine()
    if (codeLine === null) return null
    const line = this.lineNo
    const trimmed = codeLine.trim()
    if (!/^-?\d+$/.test(trimmed)) throw new DxfSyntaxError(`Geçersiz grup kodu "${trimmed.slice(0, 20)}"`, line)
    const value = this.readLine()
    if (value === null) throw new DxfSyntaxError('Dosya beklenmedik şekilde bitti (değer eksik)', line)
    return { code: Number(trimmed), value, line }
  }

  peek(): Pair | null {
    if (!this.peeked) this.peeked = this.next()
    return this.peeked
  }
}

/** Sayısal grup değeri; geçersizse null */
export function num(v: string): number | null {
  const t = v.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
