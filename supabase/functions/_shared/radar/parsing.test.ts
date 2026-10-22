import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFeed, parseFeedDate } from './feed.ts'
import { isAllowed, parseRobots, policyForStatus } from './robots.ts'
import { canonicalizeUrl, contentHash, decodeEntities, htmlToText, sha256Hex } from './sanitize.ts'
import { fold, stemMatches } from './text.ts'

const fx = (name: string) => readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf-8')

describe('feed (sentetik RSS/Atom)', () => {
  it('RSS 2.0: CDATA, varlıklar, content:encoded, dc:date; bozuk öğe atlanır', () => {
    const f = parseFeed(fx('synthetic_feed.rss.xml'))
    expect(f.kind).toBe('rss')
    expect(f.title).toBe('Sentetik İlan Akışı & Test')
    expect(f.items).toHaveLength(4)
    const [a, b, c, d] = f.items
    expect(a.title).toBe("Etimesgut'ta hizmet binası yangın kapısı alımı ihalesi")
    expect(a.link).toBe('https://akis.ornek.test/ilan/1?utm_source=rss&id=1')
    expect(a.summary).toContain('EI60 yangın kapısı temini')
    expect(a.summary).not.toContain('<b>')
    expect(a.summary).not.toContain('alert')
    expect(a.publishedAt).toBe('2026-10-20T05:30:00.000Z')
    expect(b.title).toBe('Kardelen İnşaat şehir hastanesi & poliklinik “haberi”')
    expect(b.summary).toBe('Haber metni içerik')
    expect(b.publishedAt).toBe('2026-10-18T06:00:00.000Z')
    expect(c.publishedAt).toBeNull()
    expect(f.warnings.some((w) => w.includes('Başlığı ve bağlantısı olmayan'))).toBe(true)
    expect(f.warnings.some((w) => w.includes('Tarih okunamadı'))).toBe(true)
    // Özel varlık (XXE) genişletilmez
    expect(d.title).toBe('XXE denemesi &xxe;')
  })

  it('Atom: alternate bağlantı, html özet, published/updated', () => {
    const f = parseFeed(fx('synthetic_feed.atom.xml'))
    expect(f.kind).toBe('atom')
    expect(f.items[0].link).toBe('https://akis.ornek.test/atom/1#yorumlar')
    expect(f.items[0].title).toBe("Çankaya'da ofis binası giydirme cephe yenileme")
    expect(f.items[0].summary).toBe('Cephe yenileme çalışmaları planlanıyor.')
    expect(f.items[1].publishedAt).toBe('2026-09-01T07:00:00.000Z')
  })

  it('öğe sınırı, tanınmayan belge ve bozuk XML ölümcül değildir', () => {
    const many = `<rss><channel>${Array.from({ length: 10 }, (_, i) => `<item><title>T${i}</title><link>https://a.test/${i}</link></item>`).join('')}</channel></rss>`
    const f = parseFeed(many, 3)
    expect(f.items).toHaveLength(3)
    expect(f.warnings[0]).toContain('sınırı')
    expect(parseFeed('<html><body>değil</body></html>').kind).toBe('bilinmiyor')
    const broken = parseFeed('<rss><channel><item><title>Yarım <link>https://a.test/1</link></item><item><title>Tam</title><link>https://a.test/2</link></item>')
    expect(broken.items.map((i) => i.link)).toContain('https://a.test/2')
  })

  it('tarih biçimleri', () => {
    expect(parseFeedDate('Mon, 05 Oct 2026 10:00:00 GMT')).toBe('2026-10-05T10:00:00.000Z')
    expect(parseFeedDate('5 Oct 2026 13:00 +0300')).toBe('2026-10-05T10:00:00.000Z')
    expect(parseFeedDate('2026-10-05')).toBe('2026-10-05T00:00:00.000Z')
    expect(parseFeedDate('31 Feb 2026')).toBeNull()
    expect(parseFeedDate('dün')).toBeNull()
  })
})

describe('sanitize', () => {
  it('HTML → düz metin: script/style/yorum silinir, varlıklar çözülür, uzunluk sınırı', () => {
    const t = htmlToText('<style>p{}</style><p>Merhaba&nbsp;<b>dünya</b></p><!-- gizli --><script>alert("x")</script>&#304;stanbul &#x15F; &lt;script&gt;')
    expect(t).toBe('Merhaba dünya İstanbul ş <script>')
    expect(htmlToText('a'.repeat(100), 10)).toHaveLength(10)
    expect(htmlToText('<p onclick="x()">tıkla</p><img src=x onerror=alert(1)>')).toBe('tıkla')
  })
  it('geçersiz sayısal varlıklar atılır', () => {
    expect(decodeEntities('a&#0;b&#xD800;c&#1114112;d')).toBe('abcd')
  })
  it('adres kanonikleştirme', () => {
    expect(canonicalizeUrl('HTTPS://Ornek.TEST:443/a/b/?utm_source=x&b=2&a=1&fbclid=9#bolum')).toBe('https://ornek.test/a/b?a=1&b=2')
    expect(canonicalizeUrl('https://ornek.test/')).toBe('https://ornek.test/')
    expect(canonicalizeUrl('ftp://ornek.test/x')).toBeNull()
    expect(canonicalizeUrl('javascript:alert(1)')).toBeNull()
    expect(canonicalizeUrl('https://kul:sifre@ornek.test/x')).toBe('https://ornek.test/x')
  })
  it('SHA-256 ve içerik özeti (WebCrypto)', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(await contentHash('Başlık', ' özet  metni ')).toBe(await contentHash('BAŞLIK', 'özet metni'))
  })
})

describe('Türkçe katlama ve gövde eşleşmesi', () => {
  it('İ/ı ve aksanlar', () => {
    expect(fold('YANGIN KAPISI İŞLERİ')).toBe('yangin kapisi isleri')
    expect(fold("Ankara'da Şişli Çağ Göç Üç")).toBe('ankarada sisli cag goc uc')
  })
  it('çekim ekleri izinli, başka sözcük değil', () => {
    for (const t of ['kapi', 'kapisi', 'kapilari', 'kapilarinin', 'kapida', 'kapiya']) expect(stemMatches(t, 'kapi')).toBe(true)
    expect(stemMatches('kapital', 'kapi')).toBe(false)
    expect(stemMatches('surmeli', 'surme')).toBe(true)
  })
})

describe('robots.txt', () => {
  const txt = `
User-agent: *
Disallow: /yonetim/
Allow: /yonetim/acik
Crawl-delay: 5

User-agent: LEONX-Radar
Disallow: /ozel
Allow: /ozel/ilanlar$
Disallow: /*.pdf$
`
  it('özel kullanıcı aracısı grubu ve en uzun eşleşme', () => {
    const p = parseRobots(txt)
    expect(p.group).toBe('ozel')
    expect(isAllowed(p, '/ozel/x')).toBe(false)
    expect(isAllowed(p, '/ozel/ilanlar')).toBe(true)
    expect(isAllowed(p, '/ozel/ilanlar/2')).toBe(false)
    expect(isAllowed(p, '/belge.pdf')).toBe(false)
    expect(isAllowed(p, '/yonetim/x')).toBe(true) // özel grup varken * grubu uygulanmaz
  })
  it('* grubu ve crawl-delay', () => {
    const p = parseRobots('User-agent: *\nDisallow: /yonetim/\nAllow: /yonetim/acik\nCrawl-delay: 5')
    expect(p.group).toBe('genel')
    expect(p.crawlDelay).toBe(5)
    expect(isAllowed(p, '/yonetim/gizli')).toBe(false)
    expect(isAllowed(p, '/yonetim/acik/1')).toBe(true)
    expect(isAllowed(p, '/haberler')).toBe(true)
  })
  it('HTTP durumuna göre: 404 serbest, 403/5xx tümü yasak', () => {
    expect(isAllowed(policyForStatus(404, ''), '/x')).toBe(true)
    expect(isAllowed(policyForStatus(403, ''), '/x')).toBe(false)
    expect(isAllowed(policyForStatus(503, ''), '/x')).toBe(false)
  })
})
