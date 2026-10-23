import { Bell, Scale, Search, Tags } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Panel } from '@/components/ui/Panel'
import { Toggle } from '@/components/ui/Toggle'
import { COMPANY } from '@/config/company'
import { useToast } from '@/context/toast'
import { saveRadarSettings, updateCategory } from '@/data/radarApi'
import type { RadarCategory, RadarData, RadarSettingsInput } from '@/data/radarTypes'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { DEFAULT_WEIGHTS, normalizeWeights, WEIGHT_LABEL, type WeightKey } from '@radar/score.ts'
import { GROUP_LABEL } from '@radar/taxonomy.ts'
import { Notice } from './shared'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const SETTINGS_KEYS = ['weights', 'home_city', 'min_score', 'high_priority_score', 'notify_categories', 'notify_cities', 'digest_hour', 'quiet_start', 'quiet_end',
  'critical_enabled', 'capability_text', 'search_api_enabled', 'search_monthly_limit', 'search_daily_limit', 'search_queries_per_run'] as const satisfies readonly (keyof RadarSettingsInput)[]

export function SettingsPanel({ data }: { data: RadarData }) {
  const s = data.settings
  const { notify } = useToast()
  const [form, setForm] = useState<RadarSettingsInput | null>(null)
  const [cities, setCities] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!s) return
    // Yalnız istemcinin güncelleyebildiği sütunlar (sütun düzeyi yetki: 015)
    const rest = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, s[k]])) as unknown as RadarSettingsInput
    setForm(rest)
    setCities(s.notify_cities.join(', '))
  }, [s])

  const norm = useMemo(() => normalizeWeights(form?.weights ?? DEFAULT_WEIGHTS), [form?.weights])
  const sample = data.opportunities[0]
  const preview = useMemo(() => {
    if (!sample?.score_breakdown?.length) return null
    return Math.round(sample.score_breakdown.reduce((a, p) => a + p.factor * (norm[p.key as WeightKey] ?? 0), 0))
  }, [sample, norm])

  if (!s || !form) return <p className="card px-5 py-8 text-center text-sm text-subtle">Radar ayarları yükleniyor…</p>
  const set = (patch: Partial<RadarSettingsInput>) => setForm((f) => (f ? { ...f, ...patch } : f))
  const usage = data.usage[0]

  const save = async () => {
    setBusy(true)
    setErr(null)
    try {
      const patch = Object.fromEntries(SETTINGS_KEYS.map((k) => [k, form[k]])) as Partial<RadarSettingsInput>
      await saveRadarSettings(requireSupabase(), s, { ...patch, notify_cities: cities.split(',').map((c) => c.trim()).filter(Boolean).slice(0, 120) })
      notify('Radar ayarları kaydedildi.', 'success')
    } catch (e) {
      setErr(dataErrorMessage(e, 'Ayarlar'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-6" data-testid="radar-settings">
      {err && <FormAlert>{err}</FormAlert>}
      <Panel title="Puan ağırlıkları" subtitle="Toplam 100'e normalleştirilir. Doğrulanmış ihtiyaç yoksa hiçbir puan 'Doğrulanmış iş fırsatı' etiketi vermez." icon={Scale}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(DEFAULT_WEIGHTS) as WeightKey[]).map((k) => (
            <TextField
              key={k}
              label={`${WEIGHT_LABEL[k]} (→ %${norm[k].toFixed(1).replace('.', ',')})`}
              type="number"
              min={0}
              max={100}
              value={String(form.weights[k] ?? 0)}
              onChange={(e) => set({ weights: { ...form.weights, [k]: Math.max(0, Math.min(100, Number(e.target.value) || 0)) } })}
              data-testid={`weight-${k}`}
            />
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted" data-testid="weight-preview">
          {preview == null ? 'Önizleme için en az bir fırsat gerekir.' : `Önizleme: "${sample!.title}" yeni ağırlıklarla ${preview} puan (kayıtlı: ${sample!.score}). Kaydedilen ağırlıklar sonraki taramalarda uygulanır.`}
        </p>
      </Panel>

      <Panel title="Bildirimler" subtitle="Bu süzgeçler uygulama bildiriminden ÖNCE uygulanır. Bildirim kategorisi Ayarlar › Bildirimler › İş fırsatı ile açılıp kapatılır." icon={Bell}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="En düşük fırsat puanı" type="number" min={0} max={100} value={form.min_score} onChange={(e) => set({ min_score: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} data-testid="set-min-score" />
          <TextField label="Yüksek öncelik eşiği" type="number" min={0} max={100} value={form.high_priority_score} onChange={(e) => set({ high_priority_score: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
          <TextField label="Şehir / ilçe süzgeci (virgülle; boş = tümü)" value={cities} onChange={(e) => setCities(e.target.value)} placeholder="Ankara, Etimesgut" />
          <SelectField label="Günlük özet saati" value={form.digest_hour ?? ''} onChange={(e) => set({ digest_hour: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Özet yok (anında bildir)</option>
            {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </SelectField>
          <SelectField label="Sessiz saat başlangıcı" value={form.quiet_start ?? ''} onChange={(e) => set({ quiet_start: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Yok</option>
            {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </SelectField>
          <SelectField label="Sessiz saat bitişi" value={form.quiet_end ?? ''} onChange={(e) => set({ quiet_end: e.target.value === '' ? null : Number(e.target.value) })}>
            <option value="">Yok</option>
            {HOURS.map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </SelectField>
        </div>
        <div className="mt-3">
          <Toggle id="radar-critical" checked={form.critical_enabled} onChange={(v) => set({ critical_enabled: v })} label="Öncelikli Teklif Fırsatı (doğrulanmış + son tarih ≤ 14 gün) sessiz saatte de bildirilsin" />
        </div>
        <TextAreaField
          className="mt-3"
          label="LEONX yetkinlikleri (e-posta taslakları için; satır başına bir ifade)"
          hint="Referans, sertifika veya tamamlanmış proje iddiası yazmayın. Boşsa şirket yapılandırmasındaki genel ifadeler kullanılır."
          value={form.capability_text ?? ''}
          placeholder={COMPANY.capabilities.join('\n')}
          onChange={(e) => set({ capability_text: e.target.value || null })}
        />
      </Panel>

      <Panel title="Arama API (Tavily)" subtitle="Varsayılan kapalı. Anahtar yalnız sunucu gizli değişkenindedir (TAVILY_API_KEY); arayüzde veya depoda tutulmaz." icon={Search}>
        <Notice tone="warn">Tavily ücretsiz planı ayda 1.000 kredi sunar; ücretsiz plan koşullarının ticari kullanıma uygunluğu sahip tarafından Tavily kullanım koşulları sayfasında onaylanmadan açmayın. Sonuçlar yalnız arama özetidir ve resmî kaynaklardan daha düşük güvenilirlikle değerlendirilir.</Notice>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <TextField label="Aylık üst sınır (≤ 1000)" type="number" min={0} max={1000} value={form.search_monthly_limit} onChange={(e) => set({ search_monthly_limit: Math.max(0, Math.min(1000, Number(e.target.value) || 0)) })} />
          <TextField label="Günlük üst sınır" type="number" min={0} max={200} value={form.search_daily_limit} onChange={(e) => set({ search_daily_limit: Math.max(0, Math.min(200, Number(e.target.value) || 0)) })} />
          <TextField label="Tarama başına sorgu" type="number" min={0} max={10} value={form.search_queries_per_run} onChange={(e) => set({ search_queries_per_run: Math.max(0, Math.min(10, Number(e.target.value) || 0)) })} />
        </div>
        <div className="mt-3">
          <Toggle id="radar-search" checked={form.search_api_enabled} onChange={(v) => set({ search_api_enabled: v })} label="Arama API'yi etkinleştir" description={usage ? `Bu ay ${usage.calls} / ${form.search_monthly_limit} çağrı kullanıldı.` : 'Bu ay çağrı yapılmadı.'} />
        </div>
      </Panel>

      <div>
        <Button variant="primary" disabled={busy} onClick={() => void save()} data-testid="radar-settings-save">Ayarları kaydet</Button>
      </div>

      <CategoriesPanel categories={data.categories} notifyCats={form.notify_categories} onNotifyCats={(v) => set({ notify_categories: v })} />
    </div>
  )
}

function CategoriesPanel({ categories, notifyCats, onNotifyCats }: { categories: RadarCategory[]; notifyCats: string[]; onNotifyCats: (v: string[]) => void }) {
  const { notify } = useToast()
  const [extra, setExtra] = useState<Record<string, string>>({})
  const save = async (c: RadarCategory, patch: Partial<Pick<RadarCategory, 'active' | 'extra_keywords'>>) => {
    try {
      await updateCategory(requireSupabase(), c, patch)
      notify('Kategori güncellendi.', 'success')
    } catch (e) {
      notify(dataErrorMessage(e, 'Kategori'), 'error')
    }
  }
  return (
    <Panel title="Kategoriler" subtitle="Pasif kategoriler sınıflandırmada kullanılmaz. Ek anahtar sözcükler mevcut Türkçe sözcük listesine eklenir. “Bildir” işaretliyse yalnız o kategoriler bildirilir (hiçbiri işaretli değilse tümü; kaydetmek için yukarıdaki “Ayarları kaydet”)." icon={Tags} bodyClassName="p-0">
      <ul className="divide-y divide-line" data-testid="radar-categories">
        {categories.map((c) => (
          <li key={c.key} className="flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center">
            <div className="min-w-0 flex-1">
              <div className="font-medium text-ink">{c.name}</div>
              <div className="text-[11.5px] text-muted">{GROUP_LABEL[c.group_key]}{c.extra_keywords.length ? ` · ek: ${c.extra_keywords.join(', ')}` : ''}</div>
            </div>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={c.active} onChange={(e) => void save(c, { active: e.target.checked })} aria-label={`${c.name} etkin`} /> Etkin
            </label>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink-2">
              <input type="checkbox" checked={notifyCats.includes(c.key)} onChange={(e) => onNotifyCats(e.target.checked ? [...notifyCats, c.key] : notifyCats.filter((x) => x !== c.key))} aria-label={`${c.name} bildir`} /> Bildir
            </label>
            <div className="flex min-w-0 gap-2 md:w-80">
              <input
                className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 text-base text-ink sm:text-sm"
                placeholder="ek sözcük, ek sözcük"
                aria-label={`${c.name} ek anahtar sözcükler`}
                value={extra[c.key] ?? c.extra_keywords.join(', ')}
                onChange={(e) => setExtra((x) => ({ ...x, [c.key]: e.target.value }))}
              />
              <Button variant="secondary" onClick={() => void save(c, { extra_keywords: (extra[c.key] ?? '').split(',').map((x) => x.trim().slice(0, 80)).filter(Boolean).slice(0, 30) })}>Kaydet</Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  )
}
