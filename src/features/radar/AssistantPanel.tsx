import { Bot, SendHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Panel } from '@/components/ui/Panel'
import { COMPANY } from '@/config/company'
import type { RadarData } from '@/data/radarTypes'
import { answer, type AssistantAnswer } from '@radar/assistant.ts'
import { buildViews, capabilitiesFrom, toAssistant } from '@/radar/view'

const EXAMPLES = [
  'Ankara fırsatlarını göster',
  "Etimesgut'taki yangın kapısı işleri",
  'en yüksek 5 fırsat',
  'bu hafta son tarihi olan ihaleler',
  'son 7 gün kamu ihaleleri',
]

/** Deterministik Türkçe asistan: yalnız yüklü kayıtlardan yanıt verir (dış servis ve dil modeli yok) */
export function AssistantPanel({ data }: { data: RadarData }) {
  const [q, setQ] = useState('')
  const [log, setLog] = useState<{ q: string; a: AssistantAnswer }[]>([])
  const opps = useMemo(() => toAssistant(buildViews(data), data), [data])
  const titles = useMemo(() => new Map(data.opportunities.map((o) => [o.id, o.title])), [data.opportunities])
  const ask = (text: string) => {
    if (!text.trim()) return
    const a = answer(text, opps, { now: new Date(), capabilities: capabilitiesFrom(data.settings?.capability_text, COMPANY.capabilities), companyName: COMPANY.name, website: COMPANY.website })
    setLog((l) => [{ q: text, a }, ...l].slice(0, 20))
    setQ('')
  }
  return (
    <Panel title="Radar asistanı" subtitle="Kural tabanlı; yalnız kayıtlı fırsatlardan yanıt verir. Eşleşme yoksa “Doğrulanmış sonuç bulunamadı.”" icon={Bot}>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(q) }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Örn. Ankara'daki doğrulanmış yangın kapısı fırsatları" aria-label="Asistana soru" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-base text-ink shadow-card sm:text-sm" data-testid="assistant-input" />
        <button type="submit" className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-ink" aria-label="Sor" data-testid="assistant-send">
          <SendHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {EXAMPLES.map((e) => <button key={e} type="button" className="rounded-full border border-line px-2.5 py-1 text-[11.5px] text-ink-2 hover:bg-surface-2" onClick={() => ask(e)}>{e}</button>)}
      </div>
      <ul className="mt-4 flex flex-col gap-3" data-testid="assistant-log">
        {log.map((x, i) => (
          <li key={i} className="rounded-xl border border-line bg-surface-2/60 p-3">
            <p className="text-[12px] font-semibold text-muted">Soru: {x.q}</p>
            <pre className="mt-1 font-sans text-[13px] whitespace-pre-wrap text-ink" data-testid="assistant-answer">{x.a.text}</pre>
            {x.a.recordIds.length > 0 && (
              <p className="mt-2 text-[11.5px] text-subtle" data-testid="assistant-records">
                Dayanılan kayıtlar:{' '}
                {x.a.recordIds.map((id, j) => <span key={id}>{j > 0 && ', '}<Link to={`/leonx-ai/firsat/${id}`} className="underline">{titles.get(id) ?? id.slice(0, 8)}</Link></span>)}
              </p>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  )
}
