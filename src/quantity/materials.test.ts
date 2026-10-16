import { describe, expect, it } from 'vitest'
import { computeItem } from './engine'
import { materialOf, summarizeByMaterial } from './materials'
import { emptyItem, type QuantityItem, type QuantityItemInput } from './types'

const mk = (p: Partial<QuantityItemInput>) => ({ ...emptyItem({ poz_code: 'P1', verification: 'onaylandi', width_mm: 1000, height_mm: 1000, ...p }), id: 'x' }) as QuantityItem
const attrs = (malzeme: string, status: 'dogrulandi' | 'aday' | 'belirsiz', sistem?: string) =>
  ({ reasons: [], evidence: [], attrs: { malzeme: { value: malzeme, status, source: 't' }, ...(sistem ? { sistem: { value: sistem, status: 'dogrulandi', source: 't' } } : {}) } }) as unknown as QuantityItem['detection']

describe('malzeme bazlı metraj', () => {
  it('malzeme önce çizimden, sonra iş grubundan; yoksa Belirtilmemiş (tahmin yok)', () => {
    expect(materialOf(mk({ category: 'belirsiz', detection: attrs('Alüminyum', 'dogrulandi') }))).toMatchObject({ material: 'Alüminyum', candidate: false })
    expect(materialOf(mk({ category: 'pvc_pencere', detection: attrs('ALU.', 'aday') }))).toMatchObject({ material: 'Alüminyum', candidate: true })
    expect(materialOf(mk({ category: 'pvc_pencere' }))).toMatchObject({ material: 'PVC' })
    expect(materialOf(mk({ category: 'surme', detection: attrs('?', 'belirsiz') }))).toMatchObject({ material: 'Belirtilmemiş' })
  })

  it('yalnız onaylı pozlar; malzeme + sistem gruplanır; alan motorun tamsayılarıyla', () => {
    const items = [
      mk({ category: 'pvc_pencere', quantity: 2, detection: attrs('PVC', 'dogrulandi', '70 seri') }),
      mk({ category: 'pvc_pencere', quantity: 1, width_mm: 2000, detection: attrs('PVC', 'dogrulandi', '70 seri') }),
      mk({ category: 'al_kapi', quantity: 1 }),
      mk({ category: 'pvc_pencere', quantity: 5, verification: 'bekliyor' }),
    ]
    const rows = summarizeByMaterial(items, items.map(computeItem))
    expect(rows.map((r) => [r.material, r.system, r.pieces, r.frameArea])).toEqual([
      ['PVC', '70 seri', 3, 400],
      ['Alüminyum', null, 1, 100],
    ])
    expect(rows[0].perimeter).toBe(2 * 400 + 600) // 2×4 m + 6 m
  })
})
