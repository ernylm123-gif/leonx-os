import { describe, expect, it } from 'vitest'
import { classify } from './classify.ts'
import { relevance } from './relevance.ts'

const now = new Date('2026-10-29T09:00:00Z')
const check = (title: string, summary = '') => relevance(classify({ title, summary, sourceKind: 'site', sectorHint: 'kamu', now }), title, summary)

describe('ilgililik kapısı (gerçek belediye ilan başlıkları biçiminde)', () => {
  it('LEONX ürünü geçen ilan kabul edilir', () => {
    expect(check('Hizmet Binası PVC Doğrama ve Çelik Kapı Temini ve Montajı İşi')).toEqual({ keep: true, reason: null })
    expect(check('Kültür Merkezi Cam Cephe ve Alüminyum Korkuluk Yapım İşi')).toEqual({ keep: true, reason: null })
  })
  it('proje türü + yapım işi potansiyel olarak kabul edilir; altyapı yapım işi reddedilir', () => {
    expect(check('24 Derslikli Ortaokul Binası İnşaatı Yapım İşi').keep).toBe(true)
    expect(check('Ankara İli Etimesgut İlçesi Bahçekapı Mahallesinde İtfaiye Hizmet Binası Yapım İşi').keep).toBe(true)
    expect(check('Medrese Mahallesi Akıllı Sera, GES, Su Hasadı ve Su Deposu ile Çevre Düzenlemesi Projesi Yapım İşi').keep).toBe(false)
    expect(check('Mahalle Yolları Sıcak Asfalt Kaplama Yapım İşi')).toEqual({ keep: false, reason: 'kapsam_disi_alim' })
  })
  it('satış, kiralama ve LEONX dışı mal alımları reddedilir', () => {
    expect(check('Ekonomik Ömrünü Doldurmuş (35 Adet) Araç ve (4 Adet) İş Makinası Satış İlanı')).toEqual({ keep: false, reason: 'insaat_disi' })
    expect(check('Kantin Kiralama İhalesi')).toEqual({ keep: false, reason: 'insaat_disi' })
    expect(check('Selektör, Yem Ezme, Eğimli Helezon Konveyör ve Lavanta Hasat Makineleri Mal Alımı İşi').keep).toBe(false)
    expect(check('Bilgisayar ve Yazıcı Mal Alımı İşi')).toEqual({ keep: false, reason: 'kapsam_disi_alim' })
    // Ankara BB ilan kartı biçimi: birim adı ("… Dairesi", "Bakım Onarım Şube Müdürlüğü") yapım/bina sayılmaz
    expect(check('Beynam Arazi Tipi 50 MW Güneş Enerji Santrali Yapım İşi', 'İhale Tarihi: 04.12.2026 15:00 İhale Türü: Yapım İlgili Birim: Kırsal Hizmetler Dairesi Başkanlığı').keep).toBe(false)
    expect(check('Ankara Çevre İlçelerinde Kilit Parke Taşı ile Yol ve Meydan Yapım İşi', 'İlgili Birim: Kaldırım Yapım ve Bakım Onarım Şube Müdürlüğü').keep).toBe(false)
  })
})
