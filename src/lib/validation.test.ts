import { describe, expect, it } from 'vitest'
import { validateCompany, validateContact, validateNote, validateProject } from './validation'

describe('validateCompany', () => {
  it('firma adı zorunlu', () => {
    const r = validateCompany({ name: '   ' })
    expect(r.ok).toBe(false)
    expect(r.errors.name).toBeDefined()
  })
  it('alanları temizler ve normalleştirir', () => {
    const r = validateCompany({ name: '  ACME Yapı  ', email: ' Info@Acme.COM ', tax_number: '123 456 7890', phone: '' })
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ name: 'ACME Yapı', email: 'info@acme.com', tax_number: '1234567890', phone: null })
  })
  it('hatalı e-posta, telefon ve vergi numarasını yakalar', () => {
    const r = validateCompany({ name: 'X', email: 'gecersiz', phone: 'abc', tax_number: '12' })
    expect(Object.keys(r.errors).sort()).toEqual(['email', 'phone', 'tax_number'])
  })
  it('uzunluk sınırları', () => {
    expect(validateCompany({ name: 'a'.repeat(201) }).errors.name).toBeDefined()
    expect(validateCompany({ name: 'a', notes: 'n'.repeat(5001) }).errors.notes).toBeDefined()
  })
})

describe('validateContact', () => {
  it('firma ve ad zorunlu', () => {
    const r = validateContact({})
    expect(r.errors.company_id).toBeDefined()
    expect(r.errors.full_name).toBeDefined()
  })
  it('geçerli kişi', () => {
    const r = validateContact({ company_id: 'c1', full_name: 'Ayşe Yılmaz', is_primary: true, email: 'a@b.co' })
    expect(r.ok).toBe(true)
    expect(r.value.is_primary).toBe(true)
  })
})

describe('validateProject', () => {
  const base = { code: 'lx-2026-001', name: 'Cephe', category: 'cephe' }
  it('geçerli proje; kod büyük harfe çevrilir, varsayılan durum/öncelik atanır', () => {
    const r = validateProject(base)
    expect(r.ok).toBe(true)
    expect(r.value).toMatchObject({ code: 'LX-2026-001', status: 'kesif', priority: 'normal', company_id: null })
  })
  it('zorunlu alanlar', () => {
    const r = validateProject({})
    expect(Object.keys(r.errors).sort()).toEqual(['category', 'code', 'name'])
  })
  it('kod biçimi', () => {
    expect(validateProject({ ...base, code: 'x' }).errors.code).toBeDefined()
    expect(validateProject({ ...base, code: 'LX 01' }).errors.code).toBeDefined()
    expect(validateProject({ ...base, code: '-LX' }).errors.code).toBeDefined()
  })
  it('geçersiz kategori, durum, öncelik', () => {
    const r = validateProject({ ...base, category: 'uzay', status: 'bitti', priority: 'cok' })
    expect(Object.keys(r.errors).sort()).toEqual(['category', 'priority', 'status'])
  })
  it('tarih sırası ve geçersiz tarih', () => {
    expect(validateProject({ ...base, start_date: '2026-05-10', due_date: '2026-05-01' }).errors.due_date).toBeDefined()
    expect(validateProject({ ...base, start_date: '2026-02-30' }).errors.start_date).toBeDefined()
    expect(validateProject({ ...base, start_date: '2026-05-01', due_date: '2026-05-01' }).ok).toBe(true)
  })
})

describe('validateNote', () => {
  it('boş ve uzun notları reddeder', () => {
    expect(validateNote('  ').ok).toBe(false)
    expect(validateNote('a'.repeat(5001)).ok).toBe(false)
    expect(validateNote(' Not ').value).toBe('Not')
  })
})
