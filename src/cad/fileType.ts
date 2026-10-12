/**
 * Dosya türü tespiti — uzantıya değil İÇERİĞE bakılır. CAD dosyaları güvenilmeyen veri
 * olarak işlenir; tanınmayan içerik analiz motoruna verilmez.
 */

export type CadFileKind =
  | { kind: 'dxf-ascii' }
  | { kind: 'dxf-binary' }
  | { kind: 'dwg'; version: string; release: string | null }
  | { kind: 'pdf'; version: string | null }
  | { kind: 'unknown'; reason: string }

/** DWG sürüm imzaları → AutoCAD sürümü (Open Design Specification for .dwg) */
const DWG_RELEASES: Record<string, string> = {
  AC1012: 'R13',
  AC1014: 'R14',
  AC1015: 'AutoCAD 2000',
  AC1018: 'AutoCAD 2004',
  AC1021: 'AutoCAD 2007',
  AC1024: 'AutoCAD 2010',
  AC1027: 'AutoCAD 2013',
  AC1032: 'AutoCAD 2018',
}

/** DXF $ACADVER değeri → sürüm adı */
export function acadRelease(ver: string | null | undefined): string | null {
  if (!ver) return null
  const map: Record<string, string> = {
    AC1006: 'R10',
    AC1009: 'R11/R12',
    ...DWG_RELEASES,
  }
  return map[ver] ?? null
}

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end))

export function detectCadFile(bytes: Uint8Array): CadFileKind {
  if (bytes.length < 4) return { kind: 'unknown', reason: 'Dosya çok küçük veya boş.' }
  const head = ascii(bytes, 0, Math.min(bytes.length, 32))
  if (head.startsWith('%PDF-')) {
    const m = /^%PDF-(\d\.\d)/.exec(head)
    return { kind: 'pdf', version: m ? m[1] : null }
  }
  if (head.startsWith('AutoCAD Binary DXF')) return { kind: 'dxf-binary' }
  if (/^AC10\d\d/.test(head)) {
    const version = head.slice(0, 6)
    return { kind: 'dwg', version, release: DWG_RELEASES[version] ?? null }
  }
  // ASCII DXF: ilk anlamlı satırlar "0" ve "SECTION" (veya yalnızca ENTITIES içeren eski dosyalar)
  const probe = ascii(bytes, 0, Math.min(bytes.length, 4096)).replace(/^\xEF\xBB\xBF/, '') // UTF-8 BOM (bayt olarak okunur)
  const lines = probe.split(/\r\n|\n|\r/).map((l) => l.trim())
  // Baştaki 999 (yorum) çiftleri atlanır
  let i = 0
  while (i + 1 < lines.length && lines[i] === '999') i += 2
  if (lines[i] === '0' && (lines[i + 1] === 'SECTION' || lines[i + 1] === 'EOF')) return { kind: 'dxf-ascii' }
  // İçerik metinse ama DXF değilse
  return { kind: 'unknown', reason: 'Dosya içeriği DXF, DWG veya PDF olarak tanınmadı.' }
}
