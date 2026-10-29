import { Building2, HardHat, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Panel } from '@/components/ui/Panel'
import { loadSalesOverview } from '@/data/radarApi'
import type { RadarData, RadarSalesOverview } from '@/data/radarTypes'
import { requireSupabase } from '@/lib/supabase'
import { SALES_CLASS_LABEL } from '@radar/construction.ts'
import { fmtDateTime } from '@/radar/view'
import { Kpi, Notice } from './shared'

/**
 * 019: İnşaat satış istihbaratı özeti. Sayılar radar_sales_overview() ile doğrudan veritabanından gelir.
 * B ve C sınıfları satın alma fırsatı DEĞİLDİR (açık talep doğrulanmadı); bu ayrım her yerde yazılır.
 */
export function SalesIntelPanel({ data, refreshKey }: { data: RadarData; refreshKey: number }) {
  const [ov, setOv] = useState<RadarSalesOverview | null | 'yok'>(null)
  useEffect(() => {
    let live = true
    loadSalesOverview(requireSupabase()).then((r) => live && setOv(r ?? 'yok'), () => live && setOv('yok'))
    return () => {
      live = false
    }
  }, [refreshKey])
  if (ov === null) return null
  if (ov === 'yok') return null

  const n = (k: 'A' | 'B' | 'C') => ov.by_class[k] ?? 0
  const total = n('A') + n('B') + n('C')
  const lastOk = data.runs.find((r) => r.status === 'ok' || r.status === 'degismedi')
  const active = data.sources.filter((s) => s.kind !== 'manual' && s.active && s.permission_status === 'izinli').length
  const runs24 = data.runs.filter((r) => Date.parse(r.started_at) >= Date.now() - 86400000)
  const seen24 = runs24.reduce((a, r) => a + (r.items_seen ?? 0) + (r.items_rejected ?? 0), 0)
  const rej24 = runs24.reduce((a, r) => a + (r.items_rejected ?? 0), 0)

  return (
    <Panel title="İnşaat satış istihbaratı" subtitle="Ankara → Hatay → Kahramanmaraş → komşu iller → diğer iller" icon={HardHat}>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="sales-kpis">
        <Kpi label={`A · ${SALES_CLASS_LABEL.A}`} value={n('A')} hint="Belgelenmiş ilan / teklif talebi" tone={n('A') ? 'ok' : undefined} testId="kpi-class-a" />
        <Kpi label={`B · ${SALES_CLASS_LABEL.B}`} value={n('B')} hint="Aktif inşaat; açık talep doğrulanmadı" testId="kpi-class-b" />
        <Kpi label={`C · ${SALES_CLASS_LABEL.C}`} value={n('C')} hint="Yeni / erken aşama; izleniyor" testId="kpi-class-c" />
        <Kpi label="Satın almaya yaklaşan" value={ov.approaching} hint="B sınıfı · TAHMİN (şimdi / 0–3 ay)" tone={ov.approaching ? 'warn' : undefined} testId="kpi-approaching" />
        <Kpi label="Bugün keşfedilen" value={ov.new_today} testId="kpi-new-today" />
        <Kpi label="Bugün güncellenen" value={ov.updated_today} testId="kpi-updated-today" />
        <Kpi label="Etkin doğrulanmış kaynak" value={active} hint={`Son başarılı tarama: ${lastOk ? fmtDateTime(lastOk.finished_at ?? lastOk.started_at) : '—'}`} testId="kpi-sources" />
        <Kpi label="Son 24 saat" value={seen24} hint={`toplanan öğe · ${rej24} ilgisiz olarak reddedildi`} testId="kpi-ingest-24h" />
      </div>

      {total === 0 && (
        <Notice testId="sales-empty">
          Şu an satış sınıfı A, B veya C olan kayıt yok. Bunun nedeni uydurma veri eklenmemesidir: radar yalnız {active} doğrulanmış ve etkin kaynağı okur,
          son 24 saatte {seen24} öğe topladı ve {rej24} tanesini LEONX ürünleriyle ilgisiz olduğu için eledi. Yeni kaynak eklemek için “Kaynaklar” bölümünü kullanın;
          kaynaklar eklenmeden önce erişim koşulları (robots.txt, giriş/CAPTCHA) sunucuda doğrulanır.
        </Notice>
      )}

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section aria-label="İl ve ilçelere göre" data-testid="sales-by-province">
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-muted"><MapPin className="h-3.5 w-3.5" aria-hidden="true" />İl / ilçe dağılımı</h3>
          {ov.by_province.length === 0 ? (
            <p className="mt-2 text-[12px] text-subtle">Konumu belirlenmiş kayıt yok.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-[13px]">
              {ov.by_province.map((p) => (
                <li key={p.city} className="py-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">{p.city}{p.priority && p.priority <= 3 ? <span className="ml-1.5 rounded bg-surface-2 px-1 text-[10.5px] text-ink-2">öncelik {p.priority}</span> : null}</span>
                    <span className="text-[11.5px] text-muted">A {p.a} · B {p.b} · C {p.c}</span>
                  </div>
                  {p.districts.length > 0 && <p className="text-[11.5px] text-subtle">{p.districts.map((d) => `${d.district} (${d.n})`).join(', ')}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="İletişime geçilecek yükleniciler" data-testid="sales-contractors">
          <h3 className="flex items-center gap-1.5 text-[12px] font-semibold text-muted"><Building2 className="h-3.5 w-3.5" aria-hidden="true" />İletişime geçilecek yükleniciler</h3>
          {ov.contractors_to_contact.length === 0 ? (
            <p className="mt-2 text-[12px] text-subtle">A veya B sınıfı projeye bağlı, son 14 günde temas kurulmamış firma yok.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line text-[13px]">
              {ov.contractors_to_contact.map((c) => (
                <li key={c.id} className="py-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-ink">{c.name}</span>
                    <span className="text-[11.5px] text-muted">{c.projects} proje · en iyi sınıf {c.best}</span>
                  </div>
                  <p className="text-[11.5px] text-subtle">
                    {c.supplier_portal_url ? 'Tedarikçi başvuru adresi kayıtlı' : 'Doğrulanmış tedarikçi başvuru adresi yok'}
                    {c.next_action ? ` · Sonraki: ${c.next_action}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          )}
          {ov.excluded_companies.length > 0 && (
            <p className="mt-2 text-[11.5px] text-subtle" data-testid="sales-excluded">Önerilmeyen firmalar: {ov.excluded_companies.join(', ')}</p>
          )}
        </section>
      </div>
    </Panel>
  )
}
