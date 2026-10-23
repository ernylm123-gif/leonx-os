/**
 * LEONX AI Radar fırsat raporu (PDF ve Excel ortak modeli). Bölümler A–F; doğrulanmış ve
 * potansiyel bilgiler ayrı etiketlenir, öneriler "öneri" olarak işaretlenir, her kaynak adresi,
 * yayın tarihi ve erişim zamanıyla listelenir. Bilinmeyen değerler "bilinmiyor" yazılır.
 */
import { CONTACT_KIND_LABEL } from '@radar/contacts.ts'
import { LABEL_TEXT } from '@radar/score.ts'
import { categoryName } from '@radar/taxonomy.ts'
import { ROLE_LABEL, SECTOR_LABEL, STAGE_LABEL, STATUS_LABEL, type RadarAction, type RadarEvidence } from '@/data/radarTypes'
import { fmtDateTime, fmtDay, locationText, missingInfo, type OppView, projectTypeLabel, risks, strategy } from '@/radar/view'

export interface ReportRow {
  label: string
  value: string
  tone?: 'ok' | 'warn' | 'muted'
}
export interface ReportSection {
  key: string
  title: string
  rows: ReportRow[]
  note?: string
}
export interface RadarReport {
  title: string
  subtitle: string
  generatedAt: Date
  sections: ReportSection[]
  sources: { claim: string; url: string; published: string; accessed: string }[]
}

export function buildRadarReport(v: OppView, evidence: RadarEvidence[], actions: RadarAction[], now = new Date()): RadarReport {
  const o = v.opp
  const today = now.toISOString().slice(0, 10)
  const st = strategy(v)
  const ver = v.categories.filter((c) => c.need_status === 'dogrulanmis')
  const pot = v.categories.filter((c) => c.need_status !== 'dogrulanmis')
  const sections: ReportSection[] = [
    {
      key: 'A', title: 'A. Proje bilgileri', rows: [
        { label: 'Proje / fırsat', value: o.title },
        { label: 'Konum', value: locationText(o) },
        { label: 'Proje türü', value: projectTypeLabel(o.project_type) },
        { label: 'Sektör', value: SECTOR_LABEL[o.sector] },
        { label: 'Aşama', value: STAGE_LABEL[o.stage] },
        { label: 'İhale kayıt no (İKN)', value: o.tender?.ikn ?? 'bilinmiyor' },
        { label: 'Son teklif tarihi', value: fmtDay(o.deadline) },
        { label: 'İlk görülme / son güncelleme', value: `${fmtDateTime(o.first_seen_at)} / ${fmtDateTime(o.last_updated_at)}` },
        { label: 'Durum', value: STATUS_LABEL[o.status] },
      ],
    },
    {
      key: 'B', title: 'B. İş fırsatı', rows: [
        { label: 'Etiket', value: LABEL_TEXT[o.label], tone: o.verified_need ? 'ok' : 'warn' },
        { label: 'Fırsat puanı', value: `${o.score} / 100` },
        { label: 'Güvenilirlik (ayrı ölçüt)', value: `${o.reliability} / 100` },
        ...ver.map((c) => ({ label: 'Doğrulanmış kapsam', value: `${categoryName(c.category_key)} (kaynakta: ${c.matched_terms.join(', ') || '—'})`, tone: 'ok' as const })),
        ...pot.map((c) => ({ label: 'Potansiyel — doğrulanmadı', value: `${categoryName(c.category_key)} (${c.matched_terms.join(', ') || 'çıkarım'})`, tone: 'warn' as const })),
        ...missingInfo(v).map((m) => ({ label: 'Eksik bilgi', value: m, tone: 'muted' as const })),
        ...o.score_breakdown.map((p) => ({ label: `Puan: ${p.label}`, value: `${p.points} / ${p.weight} — ${p.reason}` })),
      ],
    },
    {
      key: 'C', title: 'C. Firma analizi', rows: v.companies.length
        ? v.companies.flatMap((c) => [
            { label: c.company.name, value: `${ROLE_LABEL[c.link.role]}${c.link.verified ? ' (doğrulandı)' : ' (rol tahmini — doğrulanmadı)'}` },
            { label: 'Web sitesi', value: c.company.website ? `${c.company.website}${c.company.website_verified ? ' (doğrulandı)' : ' (doğrulanmadı)'}` : 'bilinmiyor' },
            ...c.contacts.map((k) => ({ label: CONTACT_KIND_LABEL[k.kind], value: `${k.value} — kaynak: ${k.source_url} · doğrulama: ${fmtDateTime(k.verified_at)}` })),
          ])
        : [{ label: 'Firma', value: 'Kaynaklarda firma/kurum adı bulunamadı (bilinmiyor)', tone: 'muted' as const }],
    },
    {
      key: 'D', title: 'D. Ticari strateji (öneri)', note: 'Bu bölüm kayıtlı verilerden kural tabanlı olarak üretilmiş ÖNERİDİR; doğrulanmış bilgi değildir.', rows: [
        ...st.whom.map((x) => ({ label: 'Kime', value: x })),
        ...st.channels.map((x) => ({ label: 'Hangi kanal', value: x })),
        ...st.questions.map((x) => ({ label: 'Ne sorulmalı', value: x })),
        ...st.documents.map((x) => ({ label: 'İstenecek belge', value: x })),
        ...st.products.map((x) => ({ label: 'Ürün / iş kalemi', value: x })),
        { label: 'Sonraki aksiyon', value: st.nextAction },
      ],
    },
    {
      key: 'E', title: 'E. Risk analizi', rows: risks(v, today).map((r) => ({ label: 'Risk', value: r.text, tone: 'warn' as const })),
    },
  ]
  if (!sections[4].rows.length) sections[4].rows.push({ label: 'Risk', value: 'Kayıtlı risk işareti yok', tone: 'muted' })
  if (actions.length) {
    sections.push({ key: 'G', title: 'Durum geçmişi', rows: actions.map((a) => ({ label: fmtDateTime(a.created_at), value: `${a.from_status ? STATUS_LABEL[a.from_status as keyof typeof STATUS_LABEL] ?? a.from_status : '—'} → ${STATUS_LABEL[a.to_status as keyof typeof STATUS_LABEL] ?? a.to_status}${a.note ? ` · ${a.note}` : ''}` })) })
  }
  return {
    title: o.title,
    subtitle: `${locationText(o)} · ${LABEL_TEXT[o.label]} · puan ${o.score} · güvenilirlik ${o.reliability}`,
    generatedAt: now,
    sections,
    sources: evidence.map((e) => ({ claim: e.claim, url: e.url, published: fmtDay(e.published_at), accessed: fmtDateTime(e.accessed_at) })),
  }
}

export function radarFileName(title: string, ext: 'pdf' | 'xlsx'): string {
  const slug = title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ı/g, 'i').replace(/İ/g, 'I')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
  return `LEONX-Radar-${slug || 'firsat'}.${ext}`
}
