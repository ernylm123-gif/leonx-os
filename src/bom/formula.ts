/**
 * Reçete formül dili — GÜVENLİ ifade değerlendirici (eval / Function / dinamik özellik erişimi YOK).
 *
 * Dil
 *   sayı      12 · 1.5 · .5 · 1e3 yok (bilimsel gösterim desteklenmez). Ondalık ayırıcı NOKTA'dır.
 *   işleçler  + - * / ve parantez; tekli eksi/artı (-W, +3). Üs, karşılaştırma ve koşul YOKTUR.
 *   işlevler  min(a, b, …) · max(a, b, …) · ceil(x) · floor(x) · round(x)   (bağımsız değişken ayırıcı , veya ;)
 *   değişken  W en (mm) · H boy (mm) · N poz adedi · K kanat sayısı · A alan m² (W×H/1e6) · P çevre m (2×(W+H)/1000)
 *   Büyük/küçük harf duyarsızdır (w = W, CEIL = ceil).
 *
 * Kurallar
 *   • Bilinmeyen ad, sözdizimi hatası, sıfıra bölme veya tanımsız değişken AÇIK Türkçe hata verir; sonuç asla
 *     sessizce 0 sayılmaz.
 *   • Ad çözümü sabit bir switch ile yapılır; "constructor", "__proto__" gibi adlar bilinmeyen ad hatasıdır.
 *   • ceil/floor/round öncesi değer 12 anlamlı basamağa normalleştirilir: ceil(0.1*3*10) = 3 (kayan nokta artığı
 *     4 yapmaz). round yarım değerde sıfırdan uzağa yuvarlar.
 */

export const FORMULA_VARS = ['W', 'H', 'N', 'K', 'A', 'P'] as const
export type FormulaVar = (typeof FORMULA_VARS)[number]
export type FormulaVars = Partial<Record<FormulaVar, number | null>>

export const VAR_LABEL: Record<FormulaVar, string> = {
  W: 'en (mm)',
  H: 'boy (mm)',
  N: 'poz adedi',
  K: 'kanat sayısı',
  A: 'alan (m²)',
  P: 'çevre (m)',
}

const FUNCS = ['min', 'max', 'ceil', 'floor', 'round'] as const
type FuncName = (typeof FUNCS)[number]

export const MAX_FORMULA_LENGTH = 500
const MAX_DEPTH = 40

export class FormulaError extends Error {
  constructor(
    message: string,
    /** Hatanın formüldeki konumu (0 tabanlı karakter), bilinmiyorsa null */
    readonly pos: number | null = null,
  ) {
    super(message)
    this.name = 'FormulaError'
  }
}

export type Node =
  | { t: 'num'; v: number }
  | { t: 'var'; name: FormulaVar; pos: number }
  | { t: 'neg'; e: Node }
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; a: Node; b: Node; pos: number }
  | { t: 'fn'; name: FuncName; args: Node[]; pos: number }

type Tok = { k: 'num'; v: number; pos: number } | { k: 'id'; v: string; pos: number } | { k: 'op'; v: string; pos: number } | { k: 'end'; pos: number }

function asVar(name: string): FormulaVar | null {
  switch (name.toUpperCase()) {
    case 'W':
      return 'W'
    case 'H':
      return 'H'
    case 'N':
      return 'N'
    case 'K':
      return 'K'
    case 'A':
      return 'A'
    case 'P':
      return 'P'
    default:
      return null
  }
}

function asFunc(name: string): FuncName | null {
  switch (name.toLowerCase()) {
    case 'min':
      return 'min'
    case 'max':
      return 'max'
    case 'ceil':
      return 'ceil'
    case 'floor':
      return 'floor'
    case 'round':
      return 'round'
    default:
      return null
  }
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    if ((c >= '0' && c <= '9') || c === '.') {
      const start = i
      while (i < src.length && src[i] >= '0' && src[i] <= '9') i++
      if (src[i] === '.') {
        i++
        while (i < src.length && src[i] >= '0' && src[i] <= '9') i++
      }
      const text = src.slice(start, i)
      if (text === '.' || text.split('.').length > 2) throw new FormulaError(`Geçersiz sayı: "${text}"`, start)
      if (src[i] === '.') throw new FormulaError(`Geçersiz sayı: "${text}." — tek ondalık nokta kullanın`, start)
      if (src[i] === ',' && src[i + 1] >= '0' && src[i + 1] <= '9' && !insideCall(out)) {
        throw new FormulaError(`Ondalık ayırıcı olarak nokta kullanın: "${text}.${src[i + 1]}…"`, i)
      }
      out.push({ k: 'num', v: Number(text), pos: start })
      continue
    }
    if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_') {
      const start = i
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i])) i++
      out.push({ k: 'id', v: src.slice(start, i), pos: start })
      continue
    }
    if ('+-*/(),;'.includes(c)) {
      out.push({ k: 'op', v: c === ';' ? ',' : c, pos: i })
      i++
      continue
    }
    if (c === '^') throw new FormulaError('Üs (^) desteklenmez; çarpma kullanın (W*W)', i)
    if ('<>=!?:&|'.includes(c)) throw new FormulaError(`"${c}" desteklenmez: formül dilinde karşılaştırma ve koşul yoktur`, i)
    throw new FormulaError(`Geçersiz karakter: "${c}"`, i)
  }
  out.push({ k: 'end', pos: src.length })
  return out
}

/** Belirteç dizisinde açık bir işlev çağrısının içinde miyiz (virgül orada ayırıcıdır) */
function insideCall(toks: Tok[]): boolean {
  let depth = 0
  for (let j = toks.length - 1; j >= 0; j--) {
    const t = toks[j]
    if (t.k !== 'op') continue
    if (t.v === ')') depth++
    else if (t.v === '(') {
      if (depth === 0) return j > 0 && toks[j - 1].k === 'id'
      depth--
    }
  }
  return false
}

class Parser {
  private i = 0
  private depth = 0
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i]
  }
  private next(): Tok {
    return this.toks[this.i++]
  }
  private isOp(v: string): boolean {
    const t = this.peek()
    return t.k === 'op' && t.v === v
  }

  parse(): Node {
    const e = this.expr()
    const t = this.peek()
    if (t.k !== 'end') throw new FormulaError(t.k === 'op' && t.v === ')' ? 'Fazladan kapanan parantez' : `Beklenmeyen ifade: "${describe(t)}"`, t.pos)
    return e
  }

  private enter(pos: number) {
    if (++this.depth > MAX_DEPTH) throw new FormulaError('Formül çok iç içe', pos)
  }

  private expr(): Node {
    let a = this.term()
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.next() as Tok & { k: 'op' }
      a = { t: 'bin', op: op.v as '+' | '-', a, b: this.term(), pos: op.pos }
    }
    return a
  }

  private term(): Node {
    let a = this.unary()
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.next() as Tok & { k: 'op' }
      a = { t: 'bin', op: op.v as '*' | '/', a, b: this.unary(), pos: op.pos }
    }
    return a
  }

  private unary(): Node {
    if (this.isOp('-') || this.isOp('+')) {
      const op = this.next()
      this.enter(op.pos)
      const e = this.unary()
      this.depth--
      return (op as { v: string }).v === '-' ? { t: 'neg', e } : e
    }
    return this.primary()
  }

  private primary(): Node {
    const t = this.next()
    if (t.k === 'num') return { t: 'num', v: t.v }
    if (t.k === 'id') {
      if (this.isOp('(')) {
        const fn = asFunc(t.v)
        if (!fn) throw new FormulaError(`Bilinmeyen işlev: "${t.v}" (kullanılabilir: ${FUNCS.join(', ')})`, t.pos)
        this.next()
        this.enter(t.pos)
        const args: Node[] = []
        if (!this.isOp(')')) {
          args.push(this.expr())
          while (this.isOp(',')) {
            this.next()
            args.push(this.expr())
          }
        }
        if (!this.isOp(')')) throw new FormulaError(`"${fn}(" kapanmadı`, this.peek().pos)
        this.next()
        this.depth--
        if ((fn === 'min' || fn === 'max') && args.length < 1) throw new FormulaError(`${fn}() en az bir değer ister`, t.pos)
        if ((fn === 'ceil' || fn === 'floor' || fn === 'round') && args.length !== 1) throw new FormulaError(`${fn}() tek değer ister`, t.pos)
        return { t: 'fn', name: fn, args, pos: t.pos }
      }
      const v = asVar(t.v)
      if (!v) {
        const fn = asFunc(t.v)
        if (fn) throw new FormulaError(`"${fn}" bir işlevdir; parantezle kullanın: ${fn}(…)`, t.pos)
        throw new FormulaError(`Bilinmeyen değişken: "${t.v}" (kullanılabilir: ${FORMULA_VARS.join(', ')})`, t.pos)
      }
      return { t: 'var', name: v, pos: t.pos }
    }
    if (t.k === 'op' && t.v === '(') {
      this.enter(t.pos)
      const e = this.expr()
      if (!this.isOp(')')) throw new FormulaError('Parantez kapanmadı', this.peek().pos)
      this.next()
      this.depth--
      return e
    }
    if (t.k === 'end') throw new FormulaError('Formül eksik bitiyor', t.pos)
    if (t.k === 'op' && t.v === ',') throw new FormulaError('Virgül yalnız işlev değerlerini ayırır; ondalık için nokta kullanın (1.5)', t.pos)
    throw new FormulaError(`Beklenmeyen "${describe(t)}"`, t.pos)
  }
}

function describe(t: Tok): string {
  return t.k === 'end' ? 'son' : String(t.v)
}

export interface ParsedFormula {
  ast: Node
  /** Formülde geçen değişkenler */
  vars: FormulaVar[]
  source: string
}

/** Sözdizimini çözümler; hata varsa FormulaError fırlatır. */
export function parseFormula(source: string): ParsedFormula {
  const src = source ?? ''
  if (!src.trim()) throw new FormulaError('Formül boş', 0)
  if (src.length > MAX_FORMULA_LENGTH) throw new FormulaError(`Formül en fazla ${MAX_FORMULA_LENGTH} karakter olabilir`, MAX_FORMULA_LENGTH)
  const ast = new Parser(tokenize(src)).parse()
  const vars = new Set<FormulaVar>()
  const walk = (n: Node) => {
    if (n.t === 'var') vars.add(n.name)
    else if (n.t === 'neg') walk(n.e)
    else if (n.t === 'bin') {
      walk(n.a)
      walk(n.b)
    } else if (n.t === 'fn') n.args.forEach(walk)
  }
  walk(ast)
  return { ast, vars: FORMULA_VARS.filter((v) => vars.has(v)), source: src }
}

/** 12 anlamlı basamağa normalleştirme (kayan nokta artıklarını temizler) */
export const norm = (x: number) => (x === 0 ? 0 : Number(x.toPrecision(12)))

function roundHalfAway(x: number): number {
  const v = norm(x)
  return Math.sign(v) * Math.floor(Math.abs(v) + 0.5)
}

/** Türetilmiş değişkenler: A = W×H/1e6 (m²), P = 2×(W+H)/1000 (m) */
export function deriveVars(v: FormulaVars): FormulaVars {
  const out: FormulaVars = { ...v }
  if (out.A == null && v.W != null && v.H != null) out.A = (v.W * v.H) / 1_000_000
  if (out.P == null && v.W != null && v.H != null) out.P = (2 * (v.W + v.H)) / 1000
  return out
}

function evalNode(n: Node, vars: FormulaVars): number {
  switch (n.t) {
    case 'num':
      return n.v
    case 'var': {
      const v = vars[n.name]
      if (v == null || !Number.isFinite(v)) throw new FormulaError(`${n.name} (${VAR_LABEL[n.name]}) bu pozda tanımlı değil`, n.pos)
      return v
    }
    case 'neg':
      return -evalNode(n.e, vars)
    case 'bin': {
      const a = evalNode(n.a, vars)
      const b = evalNode(n.b, vars)
      if (n.op === '+') return a + b
      if (n.op === '-') return a - b
      if (n.op === '*') return a * b
      if (b === 0) throw new FormulaError('Sıfıra bölme', n.pos)
      return a / b
    }
    case 'fn': {
      const args = n.args.map((x) => evalNode(x, vars))
      switch (n.name) {
        case 'min':
          return Math.min(...args)
        case 'max':
          return Math.max(...args)
        case 'ceil':
          return Math.ceil(norm(args[0]))
        case 'floor':
          return Math.floor(norm(args[0]))
        case 'round':
          return roundHalfAway(args[0])
      }
    }
  }
  throw new FormulaError('Geçersiz ifade')
}

/** Çözümlenmiş formülü değerlendirir; tanımsız değişken, sıfıra bölme veya sonlu olmayan sonuç hatadır. */
export function evaluate(f: ParsedFormula | Node, vars: FormulaVars): number {
  const ast = 'ast' in f ? f.ast : f
  const r = evalNode(ast, deriveVars(vars))
  if (!Number.isFinite(r)) throw new FormulaError('Sonuç sayı değil')
  return norm(r)
}

export type FormulaResult = { ok: true; value: number } | { ok: false; error: string; pos: number | null }

/** Tek adımda çözümle + değerlendir (hata nesnesi döner, fırlatmaz) */
export function evalFormula(source: string, vars: FormulaVars): FormulaResult {
  try {
    return { ok: true, value: evaluate(parseFormula(source), vars) }
  } catch (e) {
    if (e instanceof FormulaError) return { ok: false, error: e.message, pos: e.pos }
    throw e
  }
}

/**
 * Kaydetmeden önce doğrulama (sözdizimi, ad ve işlev değer sayısı): hata iletisi veya null.
 * Sıfıra bölme gibi değere bağlı hatalar hesapta ilgili satırın hatası olarak gösterilir.
 */
export function checkFormula(source: string): string | null {
  try {
    parseFormula(source)
    return null
  } catch (e) {
    if (e instanceof FormulaError) return e.message
    throw e
  }
}
