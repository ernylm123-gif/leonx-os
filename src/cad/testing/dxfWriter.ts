/**
 * Testler için küçük ASCII DXF yazıcı (yalnızca test/örnek üretimi). Üretim kodu
 * DXF yazmaz; bu yardımcı büyük dosya performans testleri ve uçtan uca testlerde
 * bilinen içerikli çizim oluşturmak için kullanılır.
 */
export class DxfWriter {
  private body: string[] = []
  private blocks: string[] = []
  private layers = new Set<string>(['0'])
  private handle = 0x100

  constructor(private readonly insunits = 4) {}

  private h(): string {
    return (this.handle++).toString(16).toUpperCase()
  }

  private push(target: string[], ...pairs: (string | number)[]) {
    for (let i = 0; i < pairs.length; i += 2) target.push(String(pairs[i]), String(pairs[i + 1]))
  }

  line(x1: number, y1: number, x2: number, y2: number, layer = '0', target = this.body) {
    this.layers.add(layer)
    this.push(target, 0, 'LINE', 5, this.h(), 8, layer, 10, x1, 20, y1, 30, 0, 11, x2, 21, y2, 31, 0)
    return this
  }

  rect(x: number, y: number, w: number, h: number, layer = '0', target = this.body) {
    this.layers.add(layer)
    this.push(target, 0, 'LWPOLYLINE', 5, this.h(), 8, layer, 90, 4, 70, 1)
    for (const [px, py] of [[x, y], [x + w, y], [x + w, y + h], [x, y + h]]) this.push(target, 10, px, 20, py)
    return this
  }

  text(x: number, y: number, h: number, value: string, layer = '0', target = this.body) {
    this.layers.add(layer)
    this.push(target, 0, 'TEXT', 5, this.h(), 8, layer, 10, x, 20, y, 30, 0, 40, h, 1, value)
    return this
  }

  insert(name: string, x: number, y: number, opts: { rotation?: number; sx?: number; sy?: number; layer?: string } = {}) {
    const layer = opts.layer ?? '0'
    this.layers.add(layer)
    this.push(this.body, 0, 'INSERT', 5, this.h(), 8, layer, 2, name, 10, x, 20, y, 30, 0, 41, opts.sx ?? 1, 42, opts.sy ?? 1, 50, opts.rotation ?? 0)
    return this
  }

  block(name: string, build: (target: string[]) => void) {
    const target: string[] = []
    this.push(this.blocks, 0, 'BLOCK', 5, this.h(), 8, '0', 2, name, 70, 0, 10, 0, 20, 0, 30, 0, 3, name)
    build(target)
    this.blocks.push(...target)
    this.push(this.blocks, 0, 'ENDBLK', 5, this.h(), 8, '0')
    return this
  }

  toString(): string {
    const out: string[] = []
    const p = (...pairs: (string | number)[]) => this.push(out, ...pairs)
    p(0, 'SECTION', 2, 'HEADER', 9, '$ACADVER', 1, 'AC1015', 9, '$INSUNITS', 70, this.insunits, 0, 'ENDSEC')
    p(0, 'SECTION', 2, 'TABLES', 0, 'TABLE', 2, 'LAYER', 70, this.layers.size)
    for (const l of this.layers) p(0, 'LAYER', 2, l, 70, 0, 62, 7, 6, 'CONTINUOUS')
    p(0, 'ENDTAB', 0, 'ENDSEC')
    p(0, 'SECTION', 2, 'BLOCKS')
    out.push(...this.blocks)
    p(0, 'ENDSEC', 0, 'SECTION', 2, 'ENTITIES')
    for (const s of this.body) out.push(s)
    p(0, 'ENDSEC', 0, 'EOF')
    return out.join('\n')
  }

  toBytes(): Uint8Array {
    return new TextEncoder().encode(this.toString())
  }
}
