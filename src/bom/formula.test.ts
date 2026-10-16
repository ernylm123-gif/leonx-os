import { describe, expect, it } from 'vitest'
import { checkFormula, evalFormula, evaluate, FormulaError, MAX_FORMULA_LENGTH, parseFormula } from './formula'

const ev = (src: string, vars = {}) => {
  const r = evalFormula(src, vars)
  if (!r.ok) throw new Error(r.error)
  return r.value
}
const err = (src: string, vars = {}) => {
  const r = evalFormula(src, vars)
  if (r.ok) throw new Error(`hata beklenirken ${r.value} döndü`)
  return r.error
}

describe('formül dili — aritmetik ve öncelik', () => {
  it('çarpma/bölme toplamadan önce, soldan sağa', () => {
    expect(ev('2+3*4')).toBe(14)
    expect(ev('(2+3)*4')).toBe(20)
    expect(ev('2-3-4')).toBe(-5)
    expect(ev('8/2/2')).toBe(2)
    expect(ev('10/4')).toBe(2.5)
    expect(ev('2*(3+(4-1))/3')).toBe(4)
  })
  it('tekli eksi ve artı', () => {
    expect(ev('-2*-3')).toBe(6)
    expect(ev('-(2+3)')).toBe(-5)
    expect(ev('--4')).toBe(4)
    expect(ev('+5-+2')).toBe(3)
    expect(ev('W - -10', { W: 100 })).toBe(110)
  })
  it('ondalık sayılar nokta ile; boşluk serbest', () => {
    expect(ev(' 1.5 * 2 ')).toBe(3)
    expect(ev('.5+.25')).toBe(0.75)
    expect(ev('0.1+0.2')).toBe(0.3) // 12 anlamlı basamağa normalleştirilir
  })
})

describe('formül dili — değişkenler', () => {
  const v = { W: 1200, H: 1500, N: 4, K: 2 }
  it('W H N K ve türetilmiş A (m²) P (m)', () => {
    expect(ev('W', v)).toBe(1200)
    expect(ev('H-60', v)).toBe(1440)
    expect(ev('N*K', v)).toBe(8)
    expect(ev('A', v)).toBe(1.8)
    expect(ev('P', v)).toBe(5.4)
  })
  it('büyük/küçük harf duyarsız', () => {
    expect(ev('w*h/1000000', v)).toBe(1.8)
    expect(ev('CEIL(n/3)', v)).toBe(2)
  })
  it('tanımsız değişken açık hata verir (0 sayılmaz)', () => {
    expect(err('W+H', { W: 1000, H: null })).toMatch(/H \(boy \(mm\)\) bu pozda tanımlı değil/)
    expect(err('A', { W: 1000 })).toMatch(/A .* tanımlı değil/)
  })
})

describe('formül dili — işlevler', () => {
  it('min max ceil floor round', () => {
    expect(ev('min(3, 1, 2)')).toBe(1)
    expect(ev('max(3; 7; 2)')).toBe(7)
    expect(ev('ceil(1.01)')).toBe(2)
    expect(ev('floor(-1.5)')).toBe(-2)
    expect(ev('round(2.5)')).toBe(3)
    expect(ev('round(-2.5)')).toBe(-3)
    expect(ev('round(2.4999)')).toBe(2)
  })
  it('kayan nokta artığı yuvarlamayı bozmaz', () => {
    expect(ev('ceil(0.1*3*10)')).toBe(3)
    expect(ev('floor(0.7*10)')).toBe(7)
    expect(ev('ceil(12000/6000)')).toBe(2)
  })
  it('değer sayısı denetlenir', () => {
    expect(err('ceil(1,2)')).toMatch(/ceil\(\) tek değer ister/)
    expect(err('min()')).toMatch(/en az bir değer/)
    expect(err('round')).toMatch(/işlevdir; parantezle/)
  })
})

describe('formül dili — hatalar (Türkçe, konumlu)', () => {
  it('sözdizimi hataları', () => {
    expect(err('W +')).toMatch(/eksik bitiyor/)
    expect(err('(W')).toMatch(/Parantez kapanmadı/)
    expect(err('W)')).toMatch(/Fazladan kapanan parantez/)
    expect(err('W H')).toMatch(/Beklenmeyen ifade: "H"/)
    expect(err('')).toMatch(/Formül boş/)
    expect(err('1..2')).toMatch(/Geçersiz sayı/)
    expect(err('1.2.3')).toMatch(/Geçersiz sayı/)
  })
  it('ondalık virgül, üs ve karşılaştırma açıkça reddedilir', () => {
    expect(err('1,5*W', { W: 1 })).toMatch(/Ondalık ayırıcı olarak nokta/)
    expect(err('W^2', { W: 1 })).toMatch(/Üs/)
    expect(err('W>1', { W: 1 })).toMatch(/karşılaştırma/)
    expect(err('W==1', { W: 1 })).toMatch(/karşılaştırma/)
    expect(err('W ? 1 : 2', { W: 1 })).toMatch(/karşılaştırma ve koşul/)
  })
  it('sıfıra bölme', () => {
    expect(err('W/(H-H)', { W: 1, H: 2 })).toMatch(/Sıfıra bölme/)
  })
  it('hata konumu verilir', () => {
    try {
      parseFormula('W + foo')
      throw new Error('hata yok')
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaError)
      expect((e as FormulaError).pos).toBe(4)
    }
  })
  it('uzunluk ve iç içe sınırı', () => {
    expect(err('1+'.repeat(MAX_FORMULA_LENGTH) + '1')).toMatch(/en fazla 500 karakter/)
    expect(err('('.repeat(60) + '1' + ')'.repeat(60))).toMatch(/çok iç içe/)
  })
})

describe('formül dili — kod çalıştırma yok', () => {
  it('JavaScript adları bilinmeyen addır, değerlendirilmez', () => {
    for (const src of ['constructor', '__proto__', 'prototype', 'toString', 'valueOf', 'hasOwnProperty', 'this', 'globalThis', 'window', 'process', 'Math', 'Infinity', 'NaN']) {
      expect(err(src)).toMatch(/Bilinmeyen değişken/)
    }
    for (const src of ['constructor(1)', 'eval(1)', 'Function(1)', 'alert(1)', 'toString()', 'require(1)', 'abs(1)']) {
      expect(err(src)).toMatch(/Bilinmeyen işlev/)
    }
  })
  it('özellik erişimi, dizi, dize ve atama sözdizimi yok', () => {
    expect(err('W.constructor', { W: 1 })).toMatch(/Geçersiz sayı|Beklenmeyen/)
    expect(err('W["x"]', { W: 1 })).toMatch(/Geçersiz karakter/)
    expect(err('"1"+1')).toMatch(/Geçersiz karakter/)
    expect(err('W=1', { W: 1 })).toMatch(/karşılaştırma/)
    expect(err('`x`')).toMatch(/Geçersiz karakter/)
    expect(err('[1]')).toMatch(/Geçersiz karakter/)
  })
  it('değişken nesnesinin prototipine dokunulmaz', () => {
    const vars = Object.create({ W: 999 }) as Record<string, number>
    vars.H = 1
    // Yalnız nesnenin kendi alanları okunur: prototipten gelen W tanımsız sayılır
    expect(evaluate(parseFormula('H'), vars)).toBe(1)
    expect(err('W', vars)).toMatch(/W .* tanımlı değil/)
    expect(err('__proto__', vars)).toMatch(/Bilinmeyen değişken/)
  })
})

describe('checkFormula (kaydetmeden önce)', () => {
  it('geçerli formülde null, hatalıda ileti', () => {
    expect(checkFormula('(W-120)*(H-120)/1000000')).toBeNull()
    expect(checkFormula('W/0')).toBeNull() // değere bağlı hata hesapta satır hatası olur
    expect(checkFormula('kasa*2')).toMatch(/Bilinmeyen değişken: "kasa"/)
  })
  it('çözümleme kullanılan değişkenleri döndürür', () => {
    expect(parseFormula('ceil(N/2)+W*K').vars).toEqual(['W', 'N', 'K'])
  })
})
