/**
 * Otomatik poz tespiti (öneri motoru).
 *
 * Çizimdeki tekrar eden bloklar, kapalı dikdörtgenler, dört çizgiden oluşan dikdörtgenler ve
 * çokgenler olası doğrama pozu adayı olarak çıkarılır. Her aday için kaynak nesneler, ölçü,
 * önerilen kategori, güven düzeyi ve belirsizlik nedenleri saklanır.
 *
 * İlkeler:
 *  - Geometri malzemeyi KANITLAMAZ: PVC/alüminyum ayrımı yalnızca ad/katman metninden
 *    TAHMİN edilir ve her zaman kullanıcı onayı gerekir. Güven hiçbir zaman %100 olmaz.
 *  - Aynı nesne iki kez sayılmaz: blok içindeki parçalar ayrı aday olmaz, iç kasa/kanat
 *    çizgileri dış çerçevenin parçası sayılır, üst üste yinelenmiş kopyalar elenir, blokla
 *    çakışan çizgi/polyline blok adayına dahil edilir.
 *  - Birim doğrulanmadıysa güven düşük tutulur.
 */
import { type BBox, bboxValid, invert, type Mat, apply } from '@/cad/geometry'
import type { Scene, SceneEntity, SceneInsert } from '@/cad/types'
import type { DrawingRef, QuantityCategory, ShapeKind } from './types'

export type TypeHint = 'pencere' | 'kapi' | 'surme' | 'sabit' | 'fotoselli' | 'korkuluk' | 'cephe' | 'kompozit'
export type Material = 'pvc' | 'aluminyum'

export interface PozInstance {
  entityIds: number[]
  insertId: number | null
  bbox: BBox
  handle: string | null
  mirrored?: boolean
}

export interface PozCandidate {
  key: string
  code: string
  label: string | null
  source: DrawingRef['source']
  block: string | null
  layer: string
  count: number
  instances: PozInstance[]
  shape: ShapeKind
  width_mm: number | null
  height_mm: number | null
  height2_mm: number | null
  vertices: [number, number][] | null
  manual_area_m2: number | null
  typeHint: TypeHint | null
  material: Material | null
  category: QuantityCategory
  confidence: number
  level: 'yuksek' | 'orta' | 'dusuk'
  reasons: string[]
  evidence: string[]
  duplicatesRemoved: number
  dims: { value: string; geometricMm: number; axis: 'w' | 'h'; matches: boolean }[]
}

export interface DetectionResult {
  candidates: PozCandidate[]
  skipped: { reason: string; count: number }[]
  labelsFound: number
  unitsVerified: boolean
}

export interface DetectOptions {
  mmPerUnit: number | null
  unitsVerified: boolean
}

const POZ_RE = /^(?:POZ\s*[:.]?\s*)?([A-ZÇĞİÖŞÜ]{1,4})\s*[-_.]?\s*(\d{1,3}[A-Z]?)$/
const DIM_IN_NAME = /(\d{3,5})\s*[xX×*]\s*(\d{3,5})/
const EXCLUDED_LAYERS = /(PAFTA|CERCEVE|ANTET|TITLE|BORDER|FRAME_SHEET|DEFPOINTS|OLCU|DIM|YAZI|TEXT|HATCH|TARAMA|GRID|AKS|VIEWPORT|LOGO)/
const MIN_MM = 150
const MAX_MM = 30_000

/** Türkçe büyük harf + aksan sadeleştirme (anahtar kelime eşleştirme için) */
export function normalizeKey(s: string): string {
  return s
    .toLocaleUpperCase('tr-TR')
    .replace(/İ/g, 'I')
    .replace(/Ş/g, 'S')
    .replace(/Ğ/g, 'G')
    .replace(/Ü/g, 'U')
    .replace(/Ö/g, 'O')
    .replace(/Ç/g, 'C')
}

const TYPE_WORDS: [TypeHint, RegExp][] = [
  ['fotoselli', /FOTOSEL|OTOMATIK KAPI|AUTO ?DOOR|SENSOR/],
  ['surme', /SURME|SLIDING|SLIDE|HEBE/],
  ['korkuluk', /KORKULUK|RAILING|BALUSTRAD|PARAPET/],
  ['kompozit', /KOMPOZIT|ALUCOBOND|COMPOSITE|\bACP\b/],
  ['cephe', /CEPHE|FACADE|CURTAIN|GIYDIRME|\bCW\b/],
  ['sabit', /SABIT|\bFIX(ED)?\b/],
  ['kapi', /KAPI|DOOR/],
  ['pencere', /PENCERE|WINDOW|\bWIN\b|DOGRAMA/],
]
const MATERIAL_WORDS: [Material, RegExp][] = [
  ['pvc', /PVC/],
  ['aluminyum', /ALUMINYUM|ALUMINIUM|ALUMINUM|\bALU\b|ALU_|_ALU|\bAL\b|^AL[-_]/],
]

export function inferType(texts: string[]): { type: TypeHint | null; material: Material | null; sources: string[] } {
  let type: TypeHint | null = null
  let material: Material | null = null
  const sources: string[] = []
  for (const raw of texts) {
    if (!raw) continue
    const t = normalizeKey(raw).replace(/[_\-.]/g, ' ')
    const tt = ` ${t} `
    if (!type) {
      for (const [k, re] of TYPE_WORDS) {
        if (re.test(tt)) {
          type = k
          sources.push(raw)
          break
        }
      }
    }
    if (!material) {
      for (const [k, re] of MATERIAL_WORDS) {
        if (re.test(tt) || re.test(normalizeKey(raw))) {
          material = k
          if (!sources.includes(raw)) sources.push(raw)
          break
        }
      }
    }
  }
  return { type, material, sources }
}

export function categoryFor(type: TypeHint | null, material: Material | null): QuantityCategory {
  switch (type) {
    case 'pencere':
      return material === 'pvc' ? 'pvc_pencere' : material === 'aluminyum' ? 'al_pencere' : 'belirsiz'
    case 'kapi':
      return material === 'pvc' ? 'pvc_kapi' : material === 'aluminyum' ? 'al_kapi' : 'belirsiz'
    case 'surme':
      return 'surme'
    case 'sabit':
      return 'sabit_cam'
    case 'fotoselli':
      return 'fotoselli_kapi'
    case 'korkuluk':
      return 'korkuluk'
    case 'cephe':
      return 'cephe_dograma'
    case 'kompozit':
      return 'kompozit_cephe'
    default:
      return 'belirsiz'
  }
}

/** Poz kodu biçimindeki metin mi? ("P1", "K-01", "PK3", "POZ: D12") */
export function parsePozLabel(text: string): string | null {
  const s = text.trim().toLocaleUpperCase('tr-TR')
  if (s.length > 16) return null
  const m = POZ_RE.exec(s)
  if (!m) return null
  return `${m[1]}${s.includes('-') ? '-' : ''}${m[2]}`
}

function codeFromBlockName(name: string): string | null {
  const parts = normalizeKey(name).split(/[_\-\s.]+/)
  for (const p of parts) {
    if (DIM_IN_NAME.test(p)) continue
    if (/^(PVC|ALU|AL|WIN|DOOR|KAPI|PENCERE)$/.test(p)) continue
    const m = /^([A-Z]{1,3})(\d{1,3}[A-Z]?)$/.exec(p)
    if (m) return `${m[1]}${m[2]}`
  }
  return null
}

const bboxW = (b: BBox) => b[2] - b[0]
const bboxH = (b: BBox) => b[3] - b[1]
const center = (b: BBox): [number, number] => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]
const contains = (outer: BBox, inner: BBox, tol: number) =>
  inner[0] >= outer[0] - tol && inner[1] >= outer[1] - tol && inner[2] <= outer[2] + tol && inner[3] <= outer[3] + tol
const sameBox = (a: BBox, b: BBox, tol: number) =>
  Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol && Math.abs(a[2] - b[2]) <= tol && Math.abs(a[3] - b[3]) <= tol
function distToBox(p: [number, number], b: BBox): number {
  const dx = Math.max(b[0] - p[0], 0, p[0] - b[2])
  const dy = Math.max(b[1] - p[1], 0, p[1] - b[3])
  return Math.hypot(dx, dy)
}

interface RawCandidate {
  source: DrawingRef['source']
  instance: PozInstance
  layer: string
  block: string | null
  /** Dünya biriminde ölçüler */
  w: number
  h: number
  shape: ShapeKind
  height2: number | null
  vertices: [number, number][] | null
  area: number | null
  planSuspect: boolean
  nameTexts: string[]
  attribs: { tag: string; value: string }[]
}

export function detectPoz(scene: Scene, opts: DetectOptions): DetectionResult {
  const k = opts.mmPerUnit ?? 1
  const ents = scene.entities
  const skipped = new Map<string, number>()
  const skip = (reason: string, n = 1) => skipped.set(reason, (skipped.get(reason) ?? 0) + n)
  const tolWorld = 1 / k // 1 mm
  const sizeOk = (w: number, h: number) => w * k >= MIN_MM && h * k >= MIN_MM && w * k <= MAX_MM && h * k <= MAX_MM
  const layerExcluded = (l: string) => EXCLUDED_LAYERS.test(normalizeKey(l))

  // ---------------------------------------------------------------- etiketler
  const labels: { code: string; c: [number, number]; id: number }[] = []
  for (const e of ents) {
    if (e.kind !== 'text' || !e.text || e.owner >= 0) continue
    for (const line of e.text.lines) {
      const code = parsePozLabel(line)
      if (code) labels.push({ code, c: center(e.bbox), id: e.id })
    }
  }

  const raws: RawCandidate[] = []

  // ---------------------------------------------------------------- 1. bloklar
  const candidateInsert = new Set<number>()
  for (const ins of scene.inserts) {
    if (ins.endEntity <= ins.firstEntity || !bboxValid(ins.bbox)) continue
    // Üst referans zaten adaysa iç bloklar ayrı sayılmaz (çift sayım önlenir)
    let p = ins.parent
    let ancestorCandidate = false
    while (p >= 0) {
      if (candidateInsert.has(p)) {
        ancestorCandidate = true
        break
      }
      p = scene.inserts[p].parent
    }
    if (ancestorCandidate) continue
    const anonymous = ins.block.startsWith('*')
    const texts = [ins.block, ins.layer, ...ins.attribs.map((a) => a.value)]
    const inferred = inferType(texts)
    const local = localBox(scene, ins)
    if (!local) continue
    const w = local.w
    const h = local.h
    const hasArc = rangeHas(ents, ins, (e) => e.type === 'ARC')
    const frameRect = rangeHas(ents, ins, (e) => !!e.rect && Math.abs(e.rect.w * e.rect.h - w * h) <= 0.02 * w * h)
    const eligible = (inferred.type != null || frameRect) && !anonymous && !layerExcluded(ins.layer)
    if (!eligible) continue
    if (!sizeOk(w, Math.max(h, MIN_MM / k))) {
      skip('Boyutu doğrama için anlamsız bloklar (çok küçük/büyük)')
      continue
    }
    candidateInsert.add(ins.id)
    const planSuspect = hasArc || h * k < 350 || w * k < 350
    const ids: number[] = []
    for (let i = ins.firstEntity; i < ins.endEntity; i++) ids.push(i)
    raws.push({
      source: 'blok',
      instance: { entityIds: ids, insertId: ins.id, bbox: ins.bbox, handle: ins.handle, mirrored: ins.mirrored },
      layer: ins.layer,
      block: ins.block,
      w,
      h,
      shape: 'dikdortgen',
      height2: null,
      vertices: null,
      area: null,
      planSuspect,
      nameTexts: texts,
      attribs: ins.attribs,
    })
  }

  // ---------------------------------------------------------------- 2. kapalı dikdörtgen / çokgen
  const looseCands: RawCandidate[] = []
  for (const e of ents) {
    if (e.kind !== 'path' || !e.closed || e.insert >= 0 || e.owner >= 0) continue
    if (layerExcluded(e.layer)) {
      skip('Pafta/ölçü/yazı katmanındaki kapalı şekiller')
      continue
    }
    const bw = bboxW(e.bbox)
    const bh = bboxH(e.bbox)
    if (e.rect) {
      if (!sizeOk(e.rect.w, e.rect.h)) {
        skip('Boyutu doğrama için anlamsız dikdörtgenler')
        continue
      }
      looseCands.push(rawFromEntity(e, 'kapali_cizgi', e.rect.w, e.rect.h, 'dikdortgen', null, null, null))
      continue
    }
    const kw = inferType([e.layer]).type
    if (!kw || e.count < 3) continue
    if (!sizeOk(bw, bh)) continue
    const c = scene.coords
    const pts: [number, number][] = []
    for (let i = 0; i < e.count; i++) pts.push([c[e.start + 2 * i], c[e.start + 2 * i + 1]])
    const shape = classifyPolygon(pts, tolWorld)
    if (e.exact && e.count <= 12 && shape) {
      looseCands.push(rawFromEntity(e, 'cokgen', shape.w, shape.h, shape.kind, shape.h2, shape.kind === 'cokgen' ? relVerts(pts) : null, e.area))
    } else {
      looseCands.push(rawFromEntity(e, 'cokgen', bw, bh, 'manuel', null, null, e.area))
    }
  }

  // ---------------------------------------------------------------- 3. dört çizgiden dikdörtgen
  looseCands.push(...lineRectangles(ents, scene.coords, tolWorld, layerExcluded, sizeOk))

  // ---------------------------------------------------------------- yinelenen / iç parça / blokla çakışan eleme
  const blockBoxes = raws.map((r) => r.instance.bbox)
  looseCands.sort((a, b) => b.w * b.h - a.w * a.h)
  const kept: RawCandidate[] = []
  for (const c of looseCands) {
    const b = c.instance.bbox
    if (blockBoxes.some((bb) => sameBox(bb, b, tolWorld * 2))) {
      skip('Blokla aynı yerde çizilmiş kopya (blok adayına dahil)')
      continue
    }
    if (blockBoxes.some((bb) => contains(bb, b, tolWorld))) {
      skip('Blok içine düşen çizgiler (iç parça)')
      continue
    }
    const dup = kept.find((x) => sameBox(x.instance.bbox, b, tolWorld * 2) && x.shape === c.shape)
    if (dup) {
      dup.instance.entityIds.push(...c.instance.entityIds)
      ;(dup as RawCandidate & { dups?: number }).dups = ((dup as RawCandidate & { dups?: number }).dups ?? 0) + 1
      skip('Üst üste yinelenmiş geometri (bir kez sayıldı)')
      continue
    }
    // İç parça: dış şeklin içinde VE (alan oranı ≤ 6 veya en az üç kenara yakın). Böylece pafta
    // çerçevesi içindeki bağımsız pencereler iç parça sayılmaz.
    const outer = kept.find((x) => contains(x.instance.bbox, b, tolWorld) && x.w * x.h > c.w * c.h * 1.01 && isInnerPart(x.instance.bbox, b))
    if (outer) {
      skip('Dış çerçeve içindeki iç kasa/kanat/cam çizgileri')
      continue
    }
    kept.push(c)
  }
  // Başka pozları çevreleyen şekiller (pafta çerçevesi, kat planı sınırı) poz değildir
  const enclosing = kept.filter((x) => kept.filter((y) => y !== x && contains(x.instance.bbox, y.instance.bbox, tolWorld)).length >= 3)
  for (const x of enclosing) {
    kept.splice(kept.indexOf(x), 1)
    skip('Diğer pozları çevreleyen çerçeve / sınır şekilleri')
  }
  raws.push(...kept)

  // ---------------------------------------------------------------- gruplama
  type Group = { raws: RawCandidate[]; dups: number }
  const groups = new Map<string, Group>()
  for (const r of raws) {
    const wmm = Math.round(r.w * k)
    const hmm = Math.round(r.h * k)
    const key =
      r.source === 'blok'
        ? `B|${r.block}|${wmm}|${hmm}`
        : `G|${r.source}|${r.layer}|${r.shape}|${wmm}|${hmm}|${r.height2 != null ? Math.round(r.height2 * k) : ''}|${r.area != null ? Math.round(r.area * k * k) : ''}`
    const g = groups.get(key) ?? { raws: [], dups: 0 }
    g.raws.push(r)
    g.dups += (r as RawCandidate & { dups?: number }).dups ?? 0
    groups.set(key, g)
  }

  // ---------------------------------------------------------------- ölçüler
  const dims = ents.filter((e) => e.kind === 'group' && e.dim && e.dim.measurement != null && e.dim.p1 && e.dim.p2 && (e.dim.kind === 'dogrusal' || e.dim.kind === 'hizali'))

  // ---------------------------------------------------------------- adaylar
  const candidates: PozCandidate[] = []
  let auto = 1
  for (const [key, g] of groups) {
    const first = g.raws[0]
    const reasons: string[] = []
    const evidence: string[] = []
    let conf = 0.25

    // Etiket
    const labelVotes = new Map<string, number>()
    for (const r of g.raws) {
      const lbl = nearestLabel(labels, r.instance.bbox)
      if (lbl) labelVotes.set(lbl, (labelVotes.get(lbl) ?? 0) + 1)
    }
    const attribCode = first.attribs.map((a) => parsePozLabel(a.value)).find((x) => x)
    const blockCode = first.block ? codeFromBlockName(first.block) : null
    let label: string | null = attribCode ?? [...labelVotes.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? blockCode ?? null
    if (attribCode) evidence.push(`Poz kodu blok özniteliğinden: ${attribCode}`)
    else if (labelVotes.size) evidence.push(`Poz kodu yakındaki metinden: ${label}`)
    else if (blockCode) evidence.push(`Poz kodu blok adından: ${blockCode}`)
    if (labelVotes.size > 1) reasons.push(`Yakında birden fazla poz etiketi var (${[...labelVotes.keys()].join(', ')})`)
    if (label) conf += 0.2

    // Tür / malzeme
    const inferred = inferType([...first.nameTexts.filter(Boolean), first.layer, ...(label ? [label] : [])])
    const typeFromLabel = !inferType([...first.nameTexts, first.layer]).type && inferred.type != null
    if (inferred.type) {
      conf += typeFromLabel ? 0.03 : 0.1
      evidence.push(`Tür ipucu: ${inferred.sources.join(', ')}`)
    } else reasons.push('Doğrama türü (pencere/kapı vb.) çizimden belirlenemedi')
    if (inferred.material) {
      conf += 0.05
      reasons.push('Malzeme yalnızca ad/katman metninden tahmin edildi; geometri malzemeyi kanıtlamaz')
    } else if (inferred.type === 'pencere' || inferred.type === 'kapi') {
      reasons.push('Malzeme (PVC / alüminyum) çizimden belirlenemedi')
    }

    // Kaynak
    if (first.source === 'blok') {
      conf += g.raws.length > 1 ? 0.2 : 0.12
      evidence.push(`${g.raws.length} adet "${first.block}" blok referansı`)
      const mirrored = g.raws.filter((r) => r.instance.mirrored).length
      if (mirrored > 0 && mirrored < g.raws.length) reasons.push(`${mirrored} referans aynalı (sağ/sol açılım farkı olabilir)`)
    } else if (first.source === 'cizgi_dortgen') {
      evidence.push('Dört ayrı çizginin oluşturduğu dikdörtgen')
      reasons.push('Bloksuz çizgilerden oluşturuldu; başka bir çizimin parçası olabilir')
    } else if (first.source === 'kapali_cizgi') {
      evidence.push('Kapalı dikdörtgen polyline')
      if (!inferType([first.layer]).type) reasons.push('Katman adı doğrama ile ilişkili değil')
    } else {
      evidence.push('Kapalı çokgen')
      if (first.shape === 'manuel') reasons.push('Eğri kenarlı şekil: alan çizimden analitik alındı; şekil türünü doğrulayın')
    }
    if (g.dups > 0) evidence.push(`${g.dups} yinelenmiş kopya elendi`)

    // Ölçü yazısı karşılaştırması
    let wmm: number | null = first.w * k
    let hmm: number | null = first.h * k
    const dimNotes: PozCandidate['dims'] = []
    for (const r of g.raws) {
      for (const d of dims) {
        const axis = dimAxisOn(d, r.instance.bbox, tolWorld * 3)
        if (!axis) continue
        const geo = (d.dim!.measurement ?? 0) * k
        const target = axis === 'w' ? first.w * k : first.h * k
        if (Math.abs(geo - target) > Math.max(2, target * 0.005)) continue
        const shown = d.dim!.displayedValues
        const matches = shown.length === 0 || shown.some((v) => [1, 10, 1000].some((f) => Math.abs(v * f - geo) <= Math.max(0.6, geo * 0.0005)))
        dimNotes.push({ value: d.dim!.displayed ?? '', geometricMm: geo, axis, matches })
      }
    }
    if (dimNotes.some((d) => d.matches)) {
      conf += 0.25
      evidence.push(`Ölçü yazısı geometriyi doğruluyor (${[...new Set(dimNotes.filter((d) => d.matches).map((d) => d.value))].join(', ')})`)
    }
    for (const d of dimNotes.filter((x) => !x.matches)) {
      conf -= 0.15
      reasons.push(`Ölçü yazısı "${d.value}", çizim ${Math.round(d.geometricMm)} mm: hangisinin doğru olduğunu doğrulayın`)
    }
    if (dimNotes.length === 0) reasons.push('Bu poz için ölçü çizgisi bulunamadı; ölçüler geometriden okundu')

    // Blok adındaki ölçü
    const nm = first.block ? DIM_IN_NAME.exec(first.block) : null
    if (nm && wmm != null && hmm != null) {
      const a = Number(nm[1])
      const b = Number(nm[2])
      const ok = (Math.abs(a - wmm) <= 5 && Math.abs(b - hmm) <= 5) || (Math.abs(a - hmm) <= 5 && Math.abs(b - wmm) <= 5)
      if (ok) {
        conf += 0.05
        evidence.push(`Blok adındaki ölçü (${a}×${b}) geometriyle uyumlu`)
      } else reasons.push(`Blok adındaki ölçü (${a}×${b}) geometriyle uyuşmuyor`)
    }

    // Plan görünüşü şüphesi
    if (first.planSuspect) {
      conf -= 0.25
      reasons.push('Plan görünüşü olabilir: yükseklik çizimden okunamıyor, elle girilmelidir')
      hmm = null
    }

    // Olağan dışı ölçü
    const type = inferred.type
    if (wmm != null && hmm != null && (type === 'pencere' || type === 'kapi')) {
      const odd = type === 'kapi' ? hmm < 1700 || hmm > 3800 || wmm < 500 || wmm > 4000 : wmm < 250 || hmm < 250 || wmm > 8000 || hmm > 5000
      if (odd) {
        conf -= 0.15
        reasons.push('Ölçüler bu doğrama türü için olağan dışı')
      }
    }

    if (!opts.unitsVerified || opts.mmPerUnit == null) {
      conf = Math.min(conf, 0.4)
      reasons.unshift('Çizim birimi doğrulanmadı: ölçüler kesin değildir')
    }
    conf = Math.max(0.05, Math.min(0.95, conf))
    const level: PozCandidate['level'] = conf >= 0.7 ? 'yuksek' : conf >= 0.45 ? 'orta' : 'dusuk'

    let code = label
    if (!code) {
      code = `A${String(auto++).padStart(2, '0')}`
      reasons.push('Poz kodu çizimde bulunamadı; geçici kod atandı')
    }

    const round1 = (v: number | null) => (v == null ? null : Math.round(v * 10) / 10)
    candidates.push({
      key,
      code,
      label,
      source: first.source,
      block: first.block,
      layer: first.layer,
      count: g.raws.length,
      instances: g.raws.map((r) => r.instance),
      shape: first.shape,
      width_mm: round1(wmm),
      height_mm: round1(hmm),
      height2_mm: first.height2 != null ? round1(first.height2 * k) : null,
      vertices: first.vertices ? first.vertices.map(([x, y]) => [Math.round(x * k * 10) / 10, Math.round(y * k * 10) / 10]) : null,
      manual_area_m2: first.shape === 'manuel' && first.area != null ? Math.round(((first.area * k * k) / 1e6) * 1000) / 1000 : null,
      typeHint: type,
      material: inferred.material,
      category: categoryFor(type, inferred.material),
      confidence: Math.round(conf * 100) / 100,
      level,
      reasons,
      evidence,
      duplicatesRemoved: g.dups,
      dims: dimNotes,
    })
  }

  // Aynı etiket farklı ölçülerde kullanıldıysa kodlar ayrıştırılır
  const byCode = new Map<string, PozCandidate[]>()
  for (const c of candidates) byCode.set(c.code, [...(byCode.get(c.code) ?? []), c])
  for (const [code, list] of byCode) {
    if (list.length < 2) continue
    list.forEach((c, i) => {
      c.code = `${code}-${String.fromCharCode(97 + i)}`
      c.reasons.push(`"${code}" etiketi farklı ölçülü ${list.length} grupta görüldü; kodlar ayrıştırıldı`)
      c.confidence = Math.max(0.05, Math.round((c.confidence - 0.1) * 100) / 100)
      c.level = c.confidence >= 0.7 ? 'yuksek' : c.confidence >= 0.45 ? 'orta' : 'dusuk'
    })
  }

  candidates.sort((a, b) => a.code.localeCompare(b.code, 'tr', { numeric: true }))
  return {
    candidates,
    skipped: [...skipped.entries()].map(([reason, count]) => ({ reason, count })),
    labelsFound: labels.length,
    unitsVerified: opts.unitsVerified && opts.mmPerUnit != null,
  }
}

// ------------------------------------------------------------------ yardımcılar

function rawFromEntity(
  e: SceneEntity,
  source: DrawingRef['source'],
  w: number,
  h: number,
  shape: ShapeKind,
  height2: number | null,
  vertices: [number, number][] | null,
  area: number | null,
): RawCandidate {
  return {
    source,
    instance: { entityIds: [e.id], insertId: null, bbox: e.bbox, handle: e.handle },
    layer: e.layer,
    block: null,
    w,
    h,
    shape,
    height2,
    vertices,
    area,
    planSuspect: false,
    nameTexts: [e.layer],
    attribs: [],
  }
}

function isInnerPart(outer: BBox, inner: BBox): boolean {
  const ow = bboxW(outer)
  const oh = bboxH(outer)
  if (ow * oh <= 6 * bboxW(inner) * bboxH(inner)) return true
  const near = [inner[0] - outer[0] <= 0.1 * ow, outer[2] - inner[2] <= 0.1 * ow, inner[1] - outer[1] <= 0.1 * oh, outer[3] - inner[3] <= 0.1 * oh]
  // Kanat/cam çizgisi dış çerçevenin en az üç kenarına yakındır; köşedeki bağımsız pencere iki kenara yakındır
  return near.filter(Boolean).length >= 3
}

function rangeHas(ents: SceneEntity[], ins: SceneInsert, pred: (e: SceneEntity) => boolean): boolean {
  for (let i = ins.firstEntity; i < ins.endEntity; i++) if (pred(ents[i])) return true
  return false
}

/** Blok içeriğinin blok eksenlerindeki boyutu (dünya birimi) — döndürmeden bağımsız */
function localBox(scene: Scene, ins: SceneInsert): { w: number; h: number } | null {
  const inv = invert(ins.m)
  if (!inv) return null
  const c = scene.coords
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = ins.firstEntity; i < ins.endEntity; i++) {
    const e = scene.entities[i]
    if (e.kind === 'text' || e.kind === 'group' || e.owner >= 0) continue
    for (let j = 0; j < e.count; j++) {
      const [x, y] = apply(inv as Mat, c[e.start + 2 * j], c[e.start + 2 * j + 1])
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
  }
  if (!Number.isFinite(x0)) return null
  // Yerel eksen boyu × dünya ölçeği (aynalama mutlak değerle yok sayılır)
  return { w: (x1 - x0) * ins.sx, h: (y1 - y0) * ins.sy }
}

function nearestLabel(labels: { code: string; c: [number, number] }[], b: BBox): string | null {
  const reach = 0.6 * Math.max(bboxW(b), bboxH(b))
  let best: string | null = null
  let bestD = Infinity
  for (const l of labels) {
    const d = distToBox(l.c, b)
    if (d <= reach && d < bestD) {
      bestD = d
      best = l.code
    }
  }
  return best
}

/** Ölçünün tanım noktaları kutunun karşılıklı iki kenarındaysa hangi ekseni ölçtüğü */
function dimAxisOn(d: SceneEntity, b: BBox, tol: number): 'w' | 'h' | null {
  const p1 = d.dim!.p1!
  const p2 = d.dim!.p2!
  const ang = d.dim!.angle ?? Math.atan2(p2[1] - p1[1], p2[0] - p1[0])
  const horiz = Math.abs(Math.cos(ang)) > 0.995
  const vert = Math.abs(Math.sin(ang)) > 0.995
  const onX = (x: number) => Math.abs(x - b[0]) <= tol || Math.abs(x - b[2]) <= tol
  const onY = (y: number) => Math.abs(y - b[1]) <= tol || Math.abs(y - b[3]) <= tol
  const within = (p: [number, number]) => p[0] >= b[0] - tol && p[0] <= b[2] + tol && p[1] >= b[1] - tol && p[1] <= b[3] + tol
  if (!within(p1) || !within(p2)) return null
  if (horiz && onX(p1[0]) && onX(p2[0]) && Math.abs(p1[0] - p2[0]) > tol) return 'w'
  if (vert && onY(p1[1]) && onY(p2[1]) && Math.abs(p1[1] - p2[1]) > tol) return 'h'
  return null
}

function relVerts(pts: [number, number][]): [number, number][] {
  const mx = Math.min(...pts.map((p) => p[0]))
  const my = Math.min(...pts.map((p) => p[1]))
  return pts.map(([x, y]) => [x - mx, y - my])
}

/** Üçgen / yamuk / genel çokgen sınıflandırması (dünya biriminde) */
function classifyPolygon(pts: [number, number][], tol: number): { kind: ShapeKind; w: number; h: number; h2: number | null } | null {
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const w = maxX - minX
  const h = maxY - minY
  if (pts.length === 3) {
    const base = pts.filter((p) => Math.abs(p[1] - minY) <= tol)
    if (base.length === 2) return { kind: 'ucgen', w, h, h2: null }
    return { kind: 'cokgen', w, h, h2: null }
  }
  if (pts.length === 4) {
    // Yamuk: alt kenar yatay, iki dikey yan kenar
    const bottom = pts.filter((p) => Math.abs(p[1] - minY) <= tol)
    const left = pts.filter((p) => Math.abs(p[0] - minX) <= tol)
    const right = pts.filter((p) => Math.abs(p[0] - maxX) <= tol)
    if (bottom.length === 2 && left.length === 2 && right.length === 2) {
      const hl = Math.max(...left.map((p) => p[1])) - minY
      const hr = Math.max(...right.map((p) => p[1])) - minY
      return { kind: 'yamuk', w, h: hl, h2: hr }
    }
  }
  return { kind: 'cokgen', w, h, h2: null }
}

/** Eksenlere paralel dört çizgiden oluşan dikdörtgenler */
function lineRectangles(
  ents: SceneEntity[],
  coords: Float64Array,
  tol: number,
  layerExcluded: (l: string) => boolean,
  sizeOk: (w: number, h: number) => boolean,
): RawCandidate[] {
  type Seg = { id: number; a: number; b: number; at: number; layer: string }
  const hs: Seg[] = []
  const vs: Seg[] = []
  let n = 0
  for (const e of ents) {
    if (e.type !== 'LINE' || e.insert >= 0 || e.owner >= 0 || e.count !== 2 || layerExcluded(e.layer)) continue
    if (++n > 50_000) break
    const x1 = coords[e.start]
    const y1 = coords[e.start + 1]
    const x2 = coords[e.start + 2]
    const y2 = coords[e.start + 3]
    if (Math.abs(y1 - y2) <= tol && Math.abs(x1 - x2) > tol) hs.push({ id: e.id, a: Math.min(x1, x2), b: Math.max(x1, x2), at: (y1 + y2) / 2, layer: e.layer })
    else if (Math.abs(x1 - x2) <= tol && Math.abs(y1 - y2) > tol) vs.push({ id: e.id, a: Math.min(y1, y2), b: Math.max(y1, y2), at: (x1 + x2) / 2, layer: e.layer })
  }
  const q = (v: number) => Math.round(v / tol)
  const vIndex = new Map<string, Seg[]>()
  for (const v of vs) {
    const key = `${q(v.at)}|${q(v.a)}|${q(v.b)}`
    vIndex.set(key, [...(vIndex.get(key) ?? []), v])
  }
  const findV = (x: number, a: number, b: number): Seg | undefined => {
    for (const dx of [0, -1, 1]) for (const da of [0, -1, 1]) for (const db of [0, -1, 1]) {
      const hit = vIndex.get(`${q(x) + dx}|${q(a) + da}|${q(b) + db}`)
      if (hit?.length) return hit[0]
    }
    return undefined
  }
  const byRange = new Map<string, Seg[]>()
  for (const h of hs) {
    const key = `${q(h.a)}|${q(h.b)}`
    byRange.set(key, [...(byRange.get(key) ?? []), h])
  }
  const used = new Set<number>()
  const out: RawCandidate[] = []
  for (const list of byRange.values()) {
    if (list.length < 2) continue
    list.sort((p, r) => p.at - r.at)
    for (let i = 0; i < list.length && i < 60; i++) {
      for (let j = i + 1; j < list.length && j < 60; j++) {
        const bot = list[i]
        const top = list[j]
        if (used.has(bot.id) || used.has(top.id)) continue
        const l = findV(bot.a, bot.at, top.at)
        const r = findV(bot.b, bot.at, top.at)
        if (!l || !r || used.has(l.id) || used.has(r.id)) continue
        const w = bot.b - bot.a
        const h = top.at - bot.at
        if (!sizeOk(w, h)) continue
        for (const s of [bot, top, l, r]) used.add(s.id)
        out.push({
          source: 'cizgi_dortgen',
          instance: { entityIds: [bot.id, top.id, l.id, r.id], insertId: null, bbox: [bot.a, bot.at, bot.b, top.at], handle: null },
          layer: bot.layer,
          block: null,
          w,
          h,
          shape: 'dikdortgen',
          height2: null,
          vertices: null,
          area: null,
          planSuspect: false,
          nameTexts: [bot.layer],
          attribs: [],
        })
      }
    }
  }
  return out
}
