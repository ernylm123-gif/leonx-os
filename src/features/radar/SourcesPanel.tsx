import { FlaskConical, Link2, Pencil, Plus, Rss, ShieldCheck, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { FormAlert, SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { Modal } from '@/components/ui/Modal'
import { Panel } from '@/components/ui/Panel'
import { Toggle } from '@/components/ui/Toggle'
import { useToast } from '@/context/toast'
import { addManualItem, createSource, deleteSource, FunctionUnavailableError, type SourceTestResult, testSourceRemote, updateSource, verifySourceRemote } from '@/data/radarApi'
import { KIND_LABEL, PERMISSION_LABEL, type Permission, type RadarData, type RadarSource, type RadarSourceInput, RUN_LABEL, type SourceKind, type SourceVerification } from '@/data/radarTypes'
import { dataErrorMessage } from '@/lib/errors'
import { requireSupabase } from '@/lib/supabase'
import { fmtDateTime } from '@/radar/view'
import { ExtLink, Notice } from './shared'

/** Doğrulama engelleri (radar-scan verifySource kodları) */
const BLOCKER_LABEL: Record<string, string> = {
  robots_yasak: 'robots.txt bu sayfaya izin vermiyor',
  giris_gerekli: 'İçerik giriş gerektiriyor',
  captcha: 'İçerik CAPTCHA arkasında',
  ucret_veya_uyelik: 'Ücret / üyelik duvarı',
  ilan_basligi_yok: 'Sayfada ilan başlığı bulunamadı',
  ilan_bulunamadi: 'Yalnız menü bağlantıları okunuyor; ilanlar bulunamadı (betikle yükleniyor olabilir)',
  tur_dogrulanmaz: 'Bu kaynak türü doğrulanmaz',
}
const blockerText = (b: string) => BLOCKER_LABEL[b] ?? b

export function verificationSummary(v: SourceVerification | null | undefined): string {
  if (!v) return 'Doğrulanmadı'
  if (v.ok) return `Doğrulandı · ${v.listings ?? v.items} ilan, ${v.relevant} LEONX ile ilgili`
  return `Doğrulanamadı: ${v.blockers.map(blockerText).join('; ')}`
}

const BLOCKED_HOSTS = /(^|\.)(ekap\.kik\.gov\.tr|ilan\.gov\.tr)$/i

const blank: RadarSourceInput = { name: '', kind: 'rss', url: '', allowed_hosts: [], sector_hint: null, region_hint: null, permission_status: 'inceleniyor', permission_note: null, permission_checked_at: null, interval_minutes: 60, max_items: 50, active: false }

export function SourcesPanel({ data }: { data: RadarData }) {
  const { notify } = useToast()
  const [edit, setEdit] = useState<{ src: RadarSource | null; form: RadarSourceInput } | null>(null)
  const [del, setDel] = useState<RadarSource | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [test, setTest] = useState<{ src: RadarSource; result: SourceTestResult | null; error: string | null } | null>(null)
  const [verify, setVerify] = useState<{ src: RadarSource; result: SourceVerification | null; error: string | null } | null>(null)
  const [manual, setManual] = useState({ url: '', title: '', text: '' })
  const [manualBusy, setManualBusy] = useState(false)
  const pending = data.items.filter((i) => i.pending).length

  const save = async () => {
    if (!edit) return
    const f = edit.form
    const url = (f.url ?? '').trim()
    if (!f.name.trim()) return setErr('Kaynak adı girin.')
    if (f.kind !== 'manual' && f.kind !== 'search_api' && !/^https:\/\/[^\s/]+/.test(url)) return setErr('Adres https:// ile başlamalı.')
    let host = ''
    try {
      host = url ? new URL(url).hostname : ''
    } catch {
      return setErr('Geçersiz adres.')
    }
    if (BLOCKED_HOSTS.test(host) && (f.kind !== 'manual' || f.permission_status === 'izinli')) {
      return setErr('EKAP ve ilan.gov.tr için resmî otomatik erişim izni/API yoktur; yalnız "Elle" türünde ve izinli olmayan kaynak olarak eklenebilir.')
    }
    setBusy(true)
    setErr(null)
    try {
      const db = requireSupabase()
      const payload: RadarSourceInput = { ...f, name: f.name.trim(), url: url || null, permission_checked_at: f.permission_checked_at || null }
      if (edit.src) await updateSource(db, edit.src, payload)
      else await createSource(db, payload)
      notify('Kaynak kaydedildi.', 'success')
      setEdit(null)
    } catch (e) {
      setErr(dataErrorMessage(e, 'Kaynak kaydı'))
    } finally {
      setBusy(false)
    }
  }

  const runTest = async (src: RadarSource) => {
    setTest({ src, result: null, error: null })
    try {
      setTest({ src, result: await testSourceRemote(requireSupabase(), src.id), error: null })
    } catch (e) {
      setTest({ src, result: null, error: e instanceof FunctionUnavailableError ? e.message : dataErrorMessage(e, 'Kaynak testi') })
    }
  }

  const runVerify = async (src: RadarSource) => {
    setVerify({ src, result: null, error: null })
    try {
      setVerify({ src, result: await verifySourceRemote(requireSupabase(), src.id), error: null })
    } catch (e) {
      setVerify({ src, result: null, error: e instanceof FunctionUnavailableError ? e.message : dataErrorMessage(e, 'Kaynak doğrulama') })
    }
  }

  const addManual = async () => {
    setManualBusy(true)
    try {
      await addManualItem(requireSupabase(), manual.url.trim(), manual.title.trim(), manual.text)
      setManual({ url: '', title: '', text: '' })
      notify('Bağlantı kaydedildi; sunucu işlevi metni sınıflandıracak.', 'success')
    } catch (e) {
      notify(dataErrorMessage(e, 'Elle ekleme'), 'error')
    } finally {
      setManualBusy(false)
    }
  }

  const F = edit?.form
  const setF = (patch: Partial<RadarSourceInput>) => setEdit((x) => (x ? { ...x, form: { ...x.form, ...patch } } : x))

  return (
    <div className="flex flex-col gap-6" data-testid="radar-sources">
      <Notice>
        Yalnız <b>İzinli</b> ve <b>etkin</b> kaynaklar otomatik taranır (robots.txt ve kullanım koşullarına uyulur; giriş, CAPTCHA aşma veya izinsiz kazıma yapılmaz).
        EKAP ve ilan.gov.tr için resmî otomatik erişim izni olmadığından bu siteler yalnız elle eklenen bağlantı olarak kullanılabilir. Bir akışı izinli yapmadan önce
        önce <b>Doğrula</b> çalıştırın: sunucu robots.txt, erişim (giriş/CAPTCHA/ücret duvarı) ve ilan çıkarımını sınar. Doğrulanmamış kaynak İzinli yapılamaz.
      </Notice>

      <Panel title="Kaynaklar" subtitle={`${data.sources.length} kaynak`} icon={Rss} actions={<Button variant="primary" icon={Plus} onClick={() => { setErr(null); setEdit({ src: null, form: blank }) }} data-testid="source-add">Kaynak ekle</Button>} bodyClassName="p-0">
        {!data.sources.length ? (
          <p className="px-5 py-8 text-center text-sm text-subtle">Henüz kaynak yok. Kaynak listesi depoda hazır gelmez; izni doğrulanmış kaynakları siz eklersiniz.</p>
        ) : (
          <ul className="divide-y divide-line" data-testid="source-list">
            {data.sources.map((s) => (
              <li key={s.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-center" data-testid="source-row">
                <div className="min-w-0 flex-1">
                  <div className="font-medium break-words text-ink">{s.name}</div>
                  <div className="text-[12px] text-muted">
                    {KIND_LABEL[s.kind]} · <span data-testid="source-permission">{PERMISSION_LABEL[s.permission_status]}</span>
                    {s.permission_checked_at ? ` (kontrol ${fmtDateTime(s.permission_checked_at)})` : ''} · {s.active ? 'etkin' : 'pasif'} · her {s.interval_minutes} dk
                    {s.last_status ? ` · son: ${RUN_LABEL[s.last_status]}` : ''}
                  </div>
                  {s.url && <div className="text-[12px]"><ExtLink href={s.url} /></div>}
                  {(s.kind === 'rss' || s.kind === 'atom' || s.kind === 'site') && (
                    <div className={`text-[12px] ${s.verification?.ok ? 'text-ok' : 'text-warn'}`} data-testid="source-verification">
                      {verificationSummary(s.verification)}{s.verification?.checked_at ? ` (${fmtDateTime(s.verification.checked_at)})` : ''}
                    </div>
                  )}
                  {s.permission_note && <div className="text-[12px] text-subtle">Not: {s.permission_note}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {(s.kind === 'rss' || s.kind === 'atom' || s.kind === 'site') && (
                    <>
                      <Button variant="secondary" icon={ShieldCheck} onClick={() => void runVerify(s)} data-testid="source-verify">Doğrula</Button>
                      <Button variant="secondary" icon={FlaskConical} onClick={() => void runTest(s)} data-testid="source-test">Kaynağı test et</Button>
                    </>
                  )}
                  <Button variant="ghost" icon={Pencil} onClick={() => { setErr(null); setEdit({ src: s, form: { name: s.name, kind: s.kind, url: s.url, allowed_hosts: s.allowed_hosts, sector_hint: s.sector_hint, region_hint: s.region_hint, permission_status: s.permission_status, permission_note: s.permission_note, permission_checked_at: s.permission_checked_at, interval_minutes: s.interval_minutes, max_items: s.max_items, active: s.active } }) }} aria-label={`${s.name} düzenle`}>Düzenle</Button>
                  <Button variant="ghost" icon={Trash2} onClick={() => setDel(s)} aria-label={`${s.name} sil`}>Sil</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Elle bağlantı / not ekle" subtitle="Örn. bir ihale ilanının bağlantısı ve metni. Adres indirilmez; yapıştırdığınız metin sunucuda temizlenip sınıflandırılır." icon={Link2}>
        <div className="grid gap-3">
          <TextField label="Bağlantı (https://…)" value={manual.url} onChange={(e) => setManual((m) => ({ ...m, url: e.target.value }))} data-testid="manual-url" />
          <TextField label="Başlık" value={manual.title} onChange={(e) => setManual((m) => ({ ...m, title: e.target.value }))} data-testid="manual-title" />
          <TextAreaField label="Metin / notlar (ilan metni)" value={manual.text} onChange={(e) => setManual((m) => ({ ...m, text: e.target.value }))} data-testid="manual-text" />
          {pending > 0 && <p className="text-[12px] text-warn" data-testid="manual-pending">{pending} elle eklenen öğe sınıflandırılmayı bekliyor (sunucu işlevi çalıştığında işlenir).</p>}
          <div><Button variant="primary" disabled={manualBusy || !manual.url.trim()} onClick={() => void addManual()} data-testid="manual-save">Kaydet</Button></div>
        </div>
      </Panel>

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.src ? 'Kaynağı düzenle' : 'Kaynak ekle'} busy={busy} footer={<><Button variant="ghost" onClick={() => setEdit(null)}>Vazgeç</Button><Button variant="primary" disabled={busy} onClick={() => void save()} data-testid="source-save">Kaydet</Button></>}>
        {F && (
          <div className="grid gap-3">
            {err && <FormAlert>{err}</FormAlert>}
            <TextField label="Ad" value={F.name} onChange={(e) => setF({ name: e.target.value })} data-testid="source-name" />
            <SelectField label="Tür" value={F.kind} onChange={(e) => setF({ kind: e.target.value as SourceKind })} data-testid="source-kind">
              {Object.entries(KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
            {F.kind !== 'search_api' && <TextField label="Adres (https)" value={F.url ?? ''} onChange={(e) => setF({ url: e.target.value })} data-testid="source-url" />}
            {F.kind === 'search_api' && <Notice tone="warn">Arama API (Tavily) yalnız Ayarlar’da açılırsa ve sunucuda TAVILY_API_KEY gizli değişkeni tanımlıysa çalışır; aylık bütçe sınırı uygulanır. Ticari kullanım koşulları sahip tarafından onaylanmalıdır.</Notice>}
            <SelectField label="İzin durumu" value={F.permission_status} onChange={(e) => setF({ permission_status: e.target.value as Permission })} data-testid="source-permission-select">
              {Object.entries(PERMISSION_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </SelectField>
            <TextAreaField label="İzin notu (kullanım koşulları, robots.txt, kim kontrol etti)" value={F.permission_note ?? ''} onChange={(e) => setF({ permission_note: e.target.value || null })} />
            <TextField label="İzin kontrol tarihi" type="date" value={(F.permission_checked_at ?? '').slice(0, 10)} onChange={(e) => setF({ permission_checked_at: e.target.value ? new Date(`${e.target.value}T12:00:00`).toISOString() : null })} />
            <SelectField label="Kamu / özel ipucu" value={F.sector_hint ?? ''} onChange={(e) => setF({ sector_hint: (e.target.value || null) as RadarSourceInput['sector_hint'] })}>
              <option value="">Belirtilmedi</option>
              <option value="kamu">Kamu</option>
              <option value="ozel">Özel</option>
            </SelectField>
            <div className="grid grid-cols-2 gap-3">
              <TextField label="Tarama aralığı (dk, ≥30)" type="number" min={30} value={F.interval_minutes} onChange={(e) => setF({ interval_minutes: Math.max(30, Number(e.target.value) || 60) })} />
              <TextField label="En çok öğe" type="number" min={1} max={200} value={F.max_items} onChange={(e) => setF({ max_items: Math.min(200, Math.max(1, Number(e.target.value) || 50)) })} />
            </div>
            <TextField label="Ek izinli ana makineler (virgülle)" value={F.allowed_hosts.join(', ')} onChange={(e) => setF({ allowed_hosts: e.target.value.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 10) })} />
            <Toggle id="source-active" checked={F.active} onChange={(v) => setF({ active: v })} label="Etkin" description="Yalnız izinli kaynaklar taranır; etkin ama izinli olmayan kaynak taranmaz." />
          </div>
        )}
      </Modal>

      <Modal open={!!test} onClose={() => setTest(null)} title={test ? `Kaynak testi: ${test.src.name}` : ''} description="Hiçbir kayıt yazılmaz; yalnız güvenlik hattından indirilip ayrıştırılır." footer={<Button variant="secondary" onClick={() => setTest(null)}>Kapat</Button>}>
        {test && (
          <div className="grid gap-2 text-[13px]" data-testid="source-test-result">
            {!test.result && !test.error && <p className="text-muted">Test ediliyor…</p>}
            {test.error && <FormAlert>{test.error}</FormAlert>}
            {test.result && (
              <>
                <p>Sonuç: <b>{test.result.ok ? 'Başarılı' : 'Başarısız'}</b>{test.result.error ? ` — ${test.result.error}` : ''}</p>
                <p>HTTP: {test.result.http_status ?? '—'} · İçerik türü: {test.result.content_type ?? '—'} · robots.txt: {test.result.robots} · Öğe sayısı: <b data-testid="source-test-count">{test.result.item_count}</b></p>
                {test.result.items.length > 0 && (
                  <ol className="list-decimal pl-5">
                    {test.result.items.map((i) => <li key={i.link}><span className="text-ink">{i.title}</span> — <ExtLink href={i.link} /></li>)}
                  </ol>
                )}
                {test.result.warnings.length > 0 && <ul className="list-disc pl-5 text-warn">{test.result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              </>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!verify} onClose={() => setVerify(null)} title={verify ? `Kaynak doğrulama: ${verify.src.name}` : ''} description="Sunucu erişim koşullarını sınar; ilan yazılmaz. Sonuç kaynağa kaydedilir." footer={<Button variant="secondary" onClick={() => setVerify(null)}>Kapat</Button>}>
        {verify && (
          <div className="grid gap-2 text-[13px]" data-testid="source-verify-result">
            {!verify.result && !verify.error && <p className="text-muted">Doğrulanıyor…</p>}
            {verify.error && <FormAlert>{verify.error}</FormAlert>}
            {verify.result && (
              <>
                <p>Sonuç: <b>{verify.result.ok ? 'Doğrulandı — İzinli + Etkin yapılabilir' : 'Doğrulanamadı'}</b></p>
                <p>HTTP: {verify.result.http_status ?? '—'} · robots.txt: {verify.result.robots} · Okunan: {verify.result.items} · İlan: {verify.result.listings ?? '—'} · LEONX ile ilgili: <b>{verify.result.relevant}</b></p>
                {verify.result.blockers.length > 0 && <ul className="list-disc pl-5 text-danger">{verify.result.blockers.map((b) => <li key={b}>{blockerText(b)}</li>)}</ul>}
                {verify.result.sample.length > 0 && (
                  <ol className="list-decimal pl-5">
                    {verify.result.sample.map((i) => <li key={i.link}><span className={i.relevant ? 'text-ink' : 'text-subtle'}>{i.title}</span>{i.relevant ? ' · ilgili' : ''} — <ExtLink href={i.link} /></li>)}
                  </ol>
                )}
                {verify.result.warnings.length > 0 && <ul className="list-disc pl-5 text-warn">{verify.result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                <p className="text-[11.5px] text-subtle">Sitenin kullanım koşulları makineyle doğrulanamaz; şüphede kaynağı İzinsiz bırakın.</p>
              </>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog open={!!del} title="Kaynağı sil" message={`"${del?.name}" silinsin mi? Bu kaynaktan gelen fırsat ve kanıtlar korunur.`} busy={busy} onClose={() => setDel(null)} onConfirm={async () => {
        if (!del) return
        setBusy(true)
        try {
          await deleteSource(requireSupabase(), del.id)
          notify('Kaynak silindi.', 'success')
          setDel(null)
        } catch (e) {
          notify(dataErrorMessage(e, 'Silme'), 'error')
        } finally {
          setBusy(false)
        }
      }} />
    </div>
  )
}
