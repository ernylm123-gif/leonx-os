import { describe, expect, it } from 'vitest'
import { contentTypeFor, formatBytes, MAX_FILE_BYTES, safeObjectName, storagePathFor, validateFile } from './files'

describe('validateFile', () => {
  it('izin verilen türler', () => {
    for (const n of ['plan.pdf', 'Cephe.DWG', 'kesit.dxf', 'foto.HEIC', 'liste.xlsx']) {
      expect(validateFile({ name: n, size: 10 })).toBeNull()
    }
  })
  it('yasaklı türler ve uzantısız dosyalar', () => {
    for (const n of ['zararli.exe', 'script.js', 'sayfa.html', 'resim.svg', 'README']) {
      expect(validateFile({ name: n, size: 10 })).not.toBeNull()
    }
  })
  it('boyut sınırı (50 MB) ve boş dosya', () => {
    expect(validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES })).toBeNull()
    expect(validateFile({ name: 'a.pdf', size: MAX_FILE_BYTES + 1 })).toMatch(/sınırını aşıyor/)
    expect(validateFile({ name: 'a.pdf', size: 0 })).not.toBeNull()
  })
})

describe('depolama yolları', () => {
  it('yol ayırıcı ve özel karakterleri temizler', () => {
    expect(safeObjectName('../../Çelik Kapı Ölçü (1).pdf')).toBe('Celik-Kapi-Olcu-1.pdf')
    expect(safeObjectName('a/b\\c.dwg')).toBe('a-b-c.dwg')
    expect(safeObjectName('...pdf')).toBe('dosya.pdf')
  })
  it('yol her zaman proje klasöründe başlar', () => {
    const p = storagePathFor('11111111-1111-1111-1111-111111111111', '../x.pdf', 'u1')
    expect(p.startsWith('11111111-1111-1111-1111-111111111111/')).toBe(true)
    expect(p.split('/')).toHaveLength(2)
  })
  it('içerik türü uzantıdan belirlenir', () => {
    expect(contentTypeFor('a.DWG')).toBe('image/vnd.dwg')
    expect(contentTypeFor('a.bilinmeyen')).toBe('application/octet-stream')
  })
  it('boyut biçimi', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1536)).toBe('1,5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5,0 MB')
  })
})
