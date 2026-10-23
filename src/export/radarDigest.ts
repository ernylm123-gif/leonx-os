/**
 * Zamanlanmış radar raporu (günlük öncelikli rapor / haftalık hat ve takip özeti) → ortak rapor
 * modeli. PDF ve Excel, fırsat raporuyla aynı çiziciyi kullanır (radarPdf / radarXlsx).
 * Veriler sunucuda üretilmiş anlık görüntüdür; potansiyel fırsatlar "doğrulanmadı" diye etiketlenir.
 */
import { LABEL_TEXT } from '@radar/score.ts'
import { STAGE_LABEL, STATUS_LABEL, STATUS_ORDER, type DigestOpp, type RadarDigest } from '@/data/radarTypes'
import { fmtDateTime, fmtDay } from '@/radar/view'
import type { RadarReport, ReportRow, ReportSection } from './radarReport'

export const DIGEST_KIND_LABEL: Record<RadarDigest['kind'], string> = { gunluk: 'Günlük öncelikli rapor', haftalik: 'Haftalık hat ve takip özeti' }

function oppRow(o: DigestOpp): ReportRow {
  const parts = [
    o.city ? `${o.city}${o.district ? ` / ${o.district}` : ''}` : 'konum bilinmiyor',
    `puan ${o.score}`,
    o.label ? LABEL_TEXT[o.label] : null,
    o.stage ? STAGE_LABEL[o.stage] : null,
    STATUS_LABEL[o.status] ?? o.status,
    o.deadline ? `son tarih ${fmtDay(o.deadline)}` : null,
    o.next_action ? `sonraki aksiyon: ${o.next_action}` : null,
    o.last_touch ? `son hareket ${fmtDay(o.last_touch)}` : null,
  ].filter(Boolean)
  return { label: `${o.is_new ? '[Yeni] ' : ''}${o.title}`, value: parts.join(' · '), tone: o.label === 'dogrulanmis_firsat' ? 'ok' : undefined }
}

function listSection(key: string, title: string, list: DigestOpp[] | undefined, empty: string, note?: string): ReportSection {
  const rows = (list ?? []).map(oppRow)
  return { key, title, note, rows: rows.length ? rows : [{ label: '—', value: empty, tone: 'muted' }] }
}

export function buildDigestReport(d: RadarDigest): RadarReport {
  const p = d.payload
  const period = d.period_start === d.period_end ? fmtDay(d.period_start) : `${fmtDay(d.period_start)} – ${fmtDay(d.period_end)}`
  const sections: ReportSection[] = []
  const potentialNote = 'Etiketi "Potansiyel" olan kayıtlar kaynakla doğrulanmış ihale/satın alma DEĞİLDİR; proje türünden çıkarılmış olası ihtiyaçtır.'
  if (d.kind === 'gunluk') {
    sections.push({
      key: 'ozet', title: 'Özet', rows: [
        { label: 'Son 24 saatte yeni', value: String(p.new_count ?? 0) },
        { label: 'Son 24 saatte güncellenen', value: String(p.updated_count ?? 0) },
        { label: 'Yeni doğrulanmış ihtiyaç', value: String(p.verified_count ?? 0) },
      ],
    })
    sections.push(listSection('oncelik', 'Öncelikli fırsatlar (Ankara önce, puana göre)', p.top, 'Eşiği geçen yeni/güncellenen fırsat yok.', potentialNote))
    sections.push(listSection('son', 'Son tarihi 14 gün içinde olanlar', p.deadlines, 'Yaklaşan son tarih yok.'))
    if (p.sources) {
      sections.push({
        key: 'kaynak', title: 'Kaynak sağlığı (son 24 saat)', rows: [
          { label: 'İzinli ve etkin kaynak', value: String(p.sources.active) },
          { label: 'Art arda hata veren', value: String(p.sources.failing), tone: p.sources.failing ? 'warn' : undefined },
          { label: 'Tarama / hata', value: `${p.sources.runs_24h} / ${p.sources.errors_24h}`, tone: p.sources.errors_24h ? 'warn' : undefined },
        ],
      })
    }
  } else {
    sections.push({
      key: 'ozet', title: 'Hafta özeti', rows: [
        { label: 'Yeni fırsat', value: String(p.new_count ?? 0) },
        { label: 'Kazanılan / kaybedilen', value: `${p.won ?? 0} / ${p.lost ?? 0}` },
      ],
    })
    const pipe = p.pipeline ?? {}
    sections.push({
      key: 'hat', title: 'İş akışı hattı (tüm fırsatlar)',
      rows: STATUS_ORDER.filter((s) => (pipe[s] ?? 0) > 0).map((s) => ({ label: STATUS_LABEL[s], value: String(pipe[s]) })),
    })
    if (!sections[1].rows.length) sections[1].rows.push({ label: '—', value: 'Kayıtlı fırsat yok.', tone: 'muted' })
    sections.push(listSection('takip', '7 gündür hareketsiz takipler', p.follow_ups, 'Bekleyen takip yok.'))
    sections.push(listSection('son', 'Son tarihi 21 gün içinde olanlar', p.deadlines, 'Yaklaşan son tarih yok.', potentialNote))
  }
  return {
    title: `${DIGEST_KIND_LABEL[d.kind]} — ${period}`,
    subtitle: `Sunucuda üretildi: ${fmtDateTime(p.generated_at ?? d.created_at)} · kural tabanlı; tahminler doğrulanmış bilgi değildir`,
    generatedAt: new Date(p.generated_at ?? d.created_at),
    sections,
    sources: [],
    noSourceSection: true,
  }
}
