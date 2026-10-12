/**
 * ASCII DXF ayrıştırıcı: bölümleri (HEADER, TABLES, BLOCKS, ENTITIES) okur ve her nesneyi
 * ham grup kodlarıyla birlikte saklar. Geometrinin yorumlanması sahne oluşturucudadır
 * (src/cad/scene.ts). Ayrıştırıcı hiçbir nesneyi sessizce atmaz: tanınmayan bölüm ve
 * yapılar uyarı olarak raporlanır.
 */
import { DxfSyntaxError, num, PairReader, type Pair, unescapeDxfString } from './tokenizer'

export type Tag = [number, string]

export interface DxfEntity {
  type: string
  handle: string | null
  layer: string
  /** ACI renk (62): 256 BYLAYER, 0 BYBLOCK; null ise BYLAYER */
  color: number | null
  trueColor: number | null
  paperSpace: boolean
  invisible: boolean
  tags: Tag[]
  line: number
  /** POLYLINE için VERTEX nesneleri */
  vertices?: DxfEntity[]
  /** INSERT için ATTRIB nesneleri */
  attribs?: DxfEntity[]
}

export interface DxfLayer {
  name: string
  color: number
  trueColor: number | null
  off: boolean
  frozen: boolean
  locked: boolean
  linetype: string | null
}

export interface DxfBlock {
  name: string
  baseX: number
  baseY: number
  flags: number
  xrefPath: string | null
  entities: DxfEntity[]
  line: number
}

export interface ParseWarning {
  code: string
  message: string
  line?: number
}

export interface DxfDocument {
  acadver: string | null
  insunits: number | null
  measurement: number | null
  extmin: [number, number] | null
  extmax: [number, number] | null
  header: Map<string, Tag[]>
  layers: Map<string, DxfLayer>
  blocks: Map<string, DxfBlock>
  entities: DxfEntity[]
  sections: string[]
  warnings: ParseWarning[]
  /** Dosya sonu (EOF) bulundu mu — bulunmadıysa dosya kesik olabilir */
  complete: boolean
}

export interface ParseOptions {
  onProgress?: (fraction: number) => void
  /** Ham nesne üst sınırı (bellek koruması) */
  maxEntities?: number
}

export const DEFAULT_MAX_RAW_ENTITIES = 2_000_000

/** Metin değeri taşıyan grup kodları (Unicode kaçışları çözülür) */
const isTextCode = (code: number) => code === 1 || code === 3 || code === 2 || code === 8 || code === 7 || code === 6

function makeEntity(type: string, tags: Tag[], line: number): DxfEntity {
  let handle: string | null = null
  let layer = '0'
  let color: number | null = null
  let trueColor: number | null = null
  let paperSpace = false
  let invisible = false
  for (const [code, value] of tags) {
    switch (code) {
      case 5:
        handle = value.trim()
        break
      case 8:
        layer = value.trim() || '0'
        break
      case 62:
        color = num(value)
        break
      case 420:
        trueColor = num(value)
        break
      case 67:
        paperSpace = num(value) === 1
        break
      case 60:
        invisible = num(value) === 1
        break
    }
  }
  return { type, handle, layer, color, trueColor, paperSpace, invisible, tags, line }
}

export function parseDxf(text: string, options: ParseOptions = {}): DxfDocument {
  const reader = new PairReader(text)
  const maxEntities = options.maxEntities ?? DEFAULT_MAX_RAW_ENTITIES
  const doc: DxfDocument = {
    acadver: null,
    insunits: null,
    measurement: null,
    extmin: null,
    extmax: null,
    header: new Map(),
    layers: new Map(),
    blocks: new Map(),
    entities: [],
    sections: [],
    warnings: [],
    complete: false,
  }
  let entityCount = 0
  let lastReport = 0
  const progress = () => {
    if (!options.onProgress) return
    const p = reader.progress
    if (p - lastReport >= 0.02) {
      lastReport = p
      options.onProgress(p)
    }
  }

  const expect0 = (p: Pair | null): Pair => {
    if (!p) throw new DxfSyntaxError('Dosya beklenmedik şekilde bitti', -1)
    return p
  }

  /** Bir sonraki code 0'a kadar olan etiketleri toplar */
  const readTags = (): Tag[] => {
    const tags: Tag[] = []
    for (;;) {
      const p = reader.peek()
      if (!p || p.code === 0) return tags
      reader.next()
      tags.push([p.code, isTextCode(p.code) ? unescapeDxfString(p.value) : p.value])
    }
  }

  const skipToEndsec = () => {
    for (;;) {
      const p = reader.next()
      if (!p) return
      if (p.code === 0 && p.value.trim() === 'ENDSEC') return
    }
  }

  /** stop: 'ENDSEC' veya 'ENDBLK' — son işaretçi okunmaz (peek'te kalır) */
  const readEntities = (stop: string): DxfEntity[] => {
    const list: DxfEntity[] = []
    for (;;) {
      const p = reader.peek()
      if (!p) return list
      if (p.code !== 0) {
        // Beklenmeyen grup kodu: atla ama raporla
        reader.next()
        doc.warnings.push({ code: 'stray-tag', message: `Nesne dışında grup kodu ${p.code} atlandı`, line: p.line })
        continue
      }
      const type = p.value.trim()
      if (type === stop || type === 'ENDSEC' || type === 'EOF') return list
      reader.next()
      const ent = makeEntity(type, readTags(), p.line)
      entityCount++
      if (entityCount > maxEntities) {
        throw new DxfSyntaxError(`Çizim nesne sınırını (${maxEntities.toLocaleString('tr-TR')}) aşıyor`, p.line)
      }
      if (type === 'POLYLINE') {
        ent.vertices = []
        for (;;) {
          const q = reader.peek()
          if (!q || q.code !== 0) break
          const t = q.value.trim()
          if (t === 'VERTEX') {
            reader.next()
            ent.vertices.push(makeEntity('VERTEX', readTags(), q.line))
          } else if (t === 'SEQEND') {
            reader.next()
            readTags()
            break
          } else {
            doc.warnings.push({ code: 'polyline-no-seqend', message: 'POLYLINE için SEQEND bulunamadı', line: q.line })
            break
          }
        }
      } else if (type === 'INSERT') {
        const q0 = reader.peek()
        if (q0 && q0.code === 0 && q0.value.trim() === 'ATTRIB') {
          ent.attribs = []
          for (;;) {
            const q = reader.peek()
            if (!q || q.code !== 0) break
            const t = q.value.trim()
            if (t === 'ATTRIB') {
              reader.next()
              ent.attribs.push(makeEntity('ATTRIB', readTags(), q.line))
            } else if (t === 'SEQEND') {
              reader.next()
              readTags()
              break
            } else break
          }
        }
      }
      list.push(ent)
      if ((entityCount & 1023) === 0) progress()
    }
  }

  const parseHeader = () => {
    let current: string | null = null
    for (;;) {
      const p = expect0(reader.next())
      if (p.code === 0) {
        if (p.value.trim() === 'ENDSEC') break
        continue
      }
      if (p.code === 9) {
        current = p.value.trim()
        doc.header.set(current, [])
      } else if (current) {
        doc.header.get(current)!.push([p.code, p.value])
      }
    }
    const h = (name: string, code: number): string | null => {
      const t = doc.header.get(name)?.find((x) => x[0] === code)
      return t ? t[1].trim() : null
    }
    doc.acadver = h('$ACADVER', 1)
    const iu = h('$INSUNITS', 70)
    doc.insunits = iu != null ? num(iu) : null
    const me = h('$MEASUREMENT', 70)
    doc.measurement = me != null ? num(me) : null
    const xy = (name: string): [number, number] | null => {
      const x = h(name, 10)
      const y = h(name, 20)
      const nx = x != null ? num(x) : null
      const ny = y != null ? num(y) : null
      return nx != null && ny != null && Math.abs(nx) < 1e20 && Math.abs(ny) < 1e20 ? [nx, ny] : null
    }
    doc.extmin = xy('$EXTMIN')
    doc.extmax = xy('$EXTMAX')
  }

  const parseTables = () => {
    for (;;) {
      const p = expect0(reader.next())
      if (p.code !== 0) continue
      const v = p.value.trim()
      if (v === 'ENDSEC') return
      if (v !== 'TABLE') continue
      const tableTags = readTags()
      const tableName = tableTags.find((t) => t[0] === 2)?.[1].trim() ?? ''
      for (;;) {
        const q = expect0(reader.next())
        if (q.code !== 0) continue
        const t = q.value.trim()
        if (t === 'ENDTAB') {
          readTags()
          break
        }
        if (t === 'ENDSEC') {
          doc.warnings.push({ code: 'table-no-endtab', message: `${tableName} tablosu ENDTAB olmadan bitti`, line: q.line })
          return
        }
        const tags = readTags()
        if (tableName === 'LAYER' && t === 'LAYER') {
          const get = (c: number) => tags.find((x) => x[0] === c)?.[1]
          const name = (get(2) ?? '').trim()
          if (!name) continue
          const color = num(get(62) ?? '7') ?? 7
          const flags = num(get(70) ?? '0') ?? 0
          doc.layers.set(name, {
            name,
            color: Math.abs(color) || 7,
            trueColor: get(420) != null ? num(get(420)!) : null,
            off: color < 0,
            frozen: (flags & 1) === 1,
            locked: (flags & 4) === 4,
            linetype: get(6)?.trim() ?? null,
          })
        }
      }
    }
  }

  const parseBlocks = () => {
    for (;;) {
      const p = reader.next()
      if (!p) return
      if (p.code !== 0) continue
      const v = p.value.trim()
      if (v === 'ENDSEC') return
      if (v !== 'BLOCK') {
        doc.warnings.push({ code: 'blocks-unexpected', message: `BLOCKS bölümünde beklenmeyen "${v}"`, line: p.line })
        readTags()
        continue
      }
      const tags = readTags()
      const get = (c: number) => tags.find((x) => x[0] === c)?.[1]
      const name = (get(2) ?? get(3) ?? '').trim()
      const entities = readEntities('ENDBLK')
      const end = reader.peek()
      if (end && end.code === 0 && end.value.trim() === 'ENDBLK') {
        reader.next()
        readTags()
      } else {
        doc.warnings.push({ code: 'block-no-endblk', message: `"${name}" bloğu ENDBLK olmadan bitti`, line: p.line })
      }
      if (!name) {
        doc.warnings.push({ code: 'block-no-name', message: 'Adı olmayan blok tanımı atlandı', line: p.line })
        continue
      }
      doc.blocks.set(name, {
        name,
        baseX: num(get(10) ?? '0') ?? 0,
        baseY: num(get(20) ?? '0') ?? 0,
        flags: num(get(70) ?? '0') ?? 0,
        xrefPath: get(1)?.trim() || null,
        entities,
        line: p.line,
      })
    }
  }

  for (;;) {
    const p = reader.next()
    if (!p) break
    if (p.code === 999) continue
    if (p.code !== 0) {
      doc.warnings.push({ code: 'stray-tag', message: `Bölüm dışında grup kodu ${p.code} atlandı`, line: p.line })
      continue
    }
    const v = p.value.trim()
    if (v === 'EOF') {
      doc.complete = true
      break
    }
    if (v !== 'SECTION') {
      doc.warnings.push({ code: 'unexpected', message: `Beklenmeyen "${v.slice(0, 30)}"`, line: p.line })
      continue
    }
    const nameTag = reader.next()
    const name = nameTag && nameTag.code === 2 ? nameTag.value.trim() : ''
    doc.sections.push(name)
    switch (name) {
      case 'HEADER':
        parseHeader()
        break
      case 'TABLES':
        parseTables()
        break
      case 'BLOCKS':
        parseBlocks()
        break
      case 'ENTITIES': {
        for (const e of readEntities('ENDSEC')) doc.entities.push(e)
        const end = reader.peek()
        if (end && end.code === 0 && end.value.trim() === 'ENDSEC') reader.next()
        else doc.warnings.push({ code: 'entities-no-endsec', message: 'ENTITIES bölümü ENDSEC olmadan bitti', line: end?.line })
        break
      }
      default:
        skipToEndsec()
    }
    progress()
  }
  if (!doc.complete) doc.warnings.push({ code: 'no-eof', message: 'Dosya sonu (EOF) işareti yok; dosya eksik veya kesik olabilir.' })
  if (!doc.sections.includes('ENTITIES')) doc.warnings.push({ code: 'no-entities', message: 'ENTITIES bölümü bulunamadı.' })
  options.onProgress?.(1)
  return doc
}

// ------------------------------------------------------------------ Etiket okuma yardımcıları

export function tagNum(tags: Tag[], code: number, fallback: number): number
export function tagNum(tags: Tag[], code: number, fallback?: null): number | null
export function tagNum(tags: Tag[], code: number, fallback: number | null = null): number | null {
  for (const t of tags) if (t[0] === code) return num(t[1]) ?? fallback
  return fallback
}

export function tagStr(tags: Tag[], code: number): string | null {
  for (const t of tags) if (t[0] === code) return t[1]
  return null
}

export function tagPoint(tags: Tag[], xCode: number): [number, number, number] | null {
  const x = tagNum(tags, xCode)
  const y = tagNum(tags, xCode + 10)
  if (x == null || y == null) return null
  return [x, y, tagNum(tags, xCode + 20, 0)]
}

export function tagExtrusion(tags: Tag[]): [number, number, number] | null {
  const x = tagNum(tags, 210)
  const y = tagNum(tags, 220)
  const z = tagNum(tags, 230)
  if (x == null && y == null && z == null) return null
  return [x ?? 0, y ?? 0, z ?? 1]
}
