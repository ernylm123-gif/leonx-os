import { describe, expect, it } from 'vitest'
import type { Company, Project } from '@/data/types'
import { addDays, computeStats, countByStage, daysUntil, matchesSearch } from './stats'

const p = (over: Partial<Project>): Project => ({
  id: crypto.randomUUID(),
  code: 'LX-1',
  name: 'P',
  company_id: null,
  category: 'diger',
  status: 'kesif',
  stage: 'yeni_firsat',
  progress: 0,
  on_hold: false,
  completed_on: null,
  address: null,
  map_url: null,
  priority: 'normal',
  description: null,
  start_date: null,
  due_date: null,
  location: null,
  notes: null,
  created_by: null,
  created_at: '',
  updated_at: '',
  version: 1,
  ...over,
})

describe('computeStats', () => {
  it('boş veride sıfırlar (uydurma değer yok)', () => {
    expect(computeStats([], [], '2026-10-12')).toEqual({ total: 0, active: 0, completed: 0, companies: 0, overdue: 0, upcoming: [] })
  })
  it('aktif/tamamlanan/geciken/yaklaşan', () => {
    const projects = [
      p({ code: 'A', stage: 'uretimde', due_date: '2026-10-15' }),
      p({ code: 'B', stage: 'tamamlandi', due_date: '2026-10-13' }),
      p({ code: 'C', stage: 'montajda', due_date: '2026-10-01' }),
      p({ code: 'D', stage: 'iptal' }),
      p({ code: 'E', stage: 'yeni_firsat', due_date: '2026-12-31' }),
      p({ code: 'F', stage: 'olcu_kesif', due_date: '2026-10-12' }),
    ]
    const s = computeStats(projects, [{} as Company, {} as Company], '2026-10-12')
    expect(s).toMatchObject({ total: 6, active: 4, completed: 1, companies: 2, overdue: 1 })
    expect(s.upcoming.map((x) => x.code)).toEqual(['F', 'A'])
  })
  it('aşama sayımı 12 aşamanın tümünü içerir; teslim edilen tamamlanmış sayılır', () => {
    const c = countByStage([p({ stage: 'uretimde' }), p({ stage: 'uretimde' })])
    expect(c.find((x) => x.value === 'uretimde')?.count).toBe(2)
    expect(c).toHaveLength(12)
    expect(computeStats([p({ stage: 'teslim_edildi' })], [], '2026-10-12')).toMatchObject({ active: 0, completed: 1 })
  })
})

describe('tarih yardımcıları', () => {
  it('addDays ay sonunu aşar', () => expect(addDays('2026-10-30', 3)).toBe('2026-11-02'))
  it('daysUntil', () => {
    expect(daysUntil('2026-10-20', '2026-10-12')).toBe(8)
    expect(daysUntil('2026-10-10', '2026-10-12')).toBe(-2)
  })
})

describe('matchesSearch', () => {
  it('Türkçe karakter ve büyük/küçük harf duyarsız', () => {
    expect(matchesSearch('ışık', 'IŞIK Yapı')).toBe(true)
    expect(matchesSearch('celik kapi', 'Çelik Kapı Projesi')).toBe(true)
    expect(matchesSearch('lx-2026', null, 'LX-2026-004')).toBe(true)
    expect(matchesSearch('yok', 'Cephe')).toBe(false)
    expect(matchesSearch('', 'her şey')).toBe(true)
  })
})
