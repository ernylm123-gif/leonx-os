import { afterEach, describe, expect, it, vi } from 'vitest'
import { convertDwgRemote, DwgServiceError, qualitySummary } from './dwgService'

const ok = {
  surum: 'AC1032',
  surum_adi: 'AutoCAD 2018',
  sure_sn: 0.05,
  onarilan_metin: 1,
  uyarilar: [],
  kalite: { status: 'eksik', dxf_valid: true, audit_errors: 0, units: 'mm', counts_dwg: {}, counts_dxf: {}, lost: { INSERT: 2 }, layers: { dwg: 3, dxf: 3 }, blocks: { dwg: 1, dxf: 1 }, layouts: ['Model'], xrefs: [], proxy_entities: 0, notes: ['1 dış referans (XREF) var'] },
  dxf: btoa('0\nEOF\n'),
  pdf: null,
  pdf_rapor: null,
}
const mockFetch = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))

afterEach(() => vi.unstubAllGlobals())

describe('DWG dönüştürme servisi istemcisi', () => {
  it('oturum belirteciyle çok parçalı istek gönderir; DXF ve kalite raporunu çözer', async () => {
    const f = mockFetch(200, ok)
    vi.stubGlobal('fetch', f)
    const r = await convertDwgRemote(new ArrayBuffer(8), 'proje.dwg', 'jwt-123', { baseUrl: 'https://cad.ornek', pdf: true })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://cad.ornek/v1/dwg/donustur?pdf=1')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123')
    expect(init.body).toBeInstanceOf(FormData)
    expect(new TextDecoder().decode(r.dxf)).toBe('0\nEOF\n')
    expect(r.quality.lost).toEqual({ INSERT: 2 })
    expect(r.repairedTexts).toBe(1)
  })

  it('hata kodları anlaşılır iletilere çevrilir; servis ayrıntısı korunur', async () => {
    for (const [status, re] of [
      [401, /Oturum/],
      [403, /kullanamaz/],
      [413, /50 MB/],
      [429, /meşgul/],
    ] as const) {
      vi.stubGlobal('fetch', mockFetch(status, {}))
      await expect(convertDwgRemote(new ArrayBuffer(8), 'a.dwg', 't', { baseUrl: 'x' })).rejects.toThrow(re)
    }
    vi.stubGlobal('fetch', mockFetch(422, { detail: { kod: 'surum_desteklenmiyor', mesaj: 'DWG sürümü AC1009 desteklenmiyor' } }))
    await expect(convertDwgRemote(new ArrayBuffer(8), 'a.dwg', 't', { baseUrl: 'x' })).rejects.toMatchObject({ code: 'surum_desteklenmiyor', message: /AC1009/ })
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))))
    await expect(convertDwgRemote(new ArrayBuffer(8), 'a.dwg', 't', { baseUrl: 'x' })).rejects.toThrow(/ulaşılamadı/)
  })

  it('servis yapılandırılmamışsa istek yapılmaz', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(convertDwgRemote(new ArrayBuffer(8), 'a.dwg', 't', { baseUrl: null })).rejects.toBeInstanceOf(DwgServiceError)
    expect(f).not.toHaveBeenCalled()
  })

  it('DXF üretilemediyse (bozuk çıktı) analiz başlatılmaz', async () => {
    vi.stubGlobal('fetch', mockFetch(200, { ...ok, dxf: null, kalite: { ...ok.kalite, status: 'basarisiz', dxf_valid: false } }))
    await expect(convertDwgRemote(new ArrayBuffer(8), 'a.dwg', 't', { baseUrl: 'x' })).rejects.toMatchObject({ code: 'gecersiz_dxf' })
  })

  it('kalite özeti kayıpları, onarımları ve notları listeler; yalnız "tamam" olumlu', () => {
    const s = qualitySummary(ok.kalite as never, 1)
    expect(s.ok).toBe(false)
    expect(s.lines.join(' | ')).toMatch(/2 INSERT.*satır sonu onarıldı.*XREF/)
    expect(qualitySummary({ ...ok.kalite, status: 'tamam', lost: {}, notes: [] } as never, 0)).toEqual({ ok: true, lines: [] })
  })
})
