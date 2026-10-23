/**
 * Playwright için bellek içi SAHTE Supabase arka ucu (yalnızca test).
 *
 * Gerçek Supabase'in yerine geçmez; amaç arayüzün Auth, PostgREST, Storage ve
 * Realtime protokolleriyle doğru konuştuğunu ve tek-sahip kurallarına göre
 * davrandığını tarayıcıda doğrulamaktır. Veritabanı güvenliği (RLS) ayrıca
 * gerçek PostgreSQL üzerinde test edilir: npm run test:db
 */
import { randomUUID } from 'node:crypto'

export const SUPABASE_URL = 'https://leonx-e2e.supabase.co'
export const OWNER = { id: '0a0a0a0a-0000-4000-8000-000000000001', email: 'sahip@example.test', password: 'Dogru-Sifre-2026' }
export const INTRUDER = { id: '0b0b0b0b-0000-4000-8000-000000000002', email: 'yabanci@example.test', password: 'Dogru-Sifre-2026' }

const b64url = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const fakeJwt = (user) =>
  `${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    aud: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })}.test-imza`

const TABLES = [
  'companies',
  'contacts',
  'projects',
  'project_notes',
  'project_files',
  'project_status_history',
  'cad_analyses',
  'quantity_takeoffs',
  'quantity_items',
  'quantity_item_history',
  'quotes',
  'quote_items',
  'quote_history',
  'quote_settings',
  'project_tasks',
  'project_events',
  'notifications',
  'notification_prefs',
  'push_subscriptions',
  'cost_rates',
  'fx_rates',
  'project_budgets',
  'project_cost_lines',
  'project_expenses',
  'project_payment_schedule',
  'project_collections',
  // 015: LEONX AI Radar
  'radar_settings',
  'radar_categories',
  'radar_sources',
  'radar_source_runs',
  'radar_items',
  'radar_opportunities',
  'radar_opportunity_categories',
  'radar_evidence',
  'radar_companies',
  'radar_opportunity_companies',
  'radar_contacts',
  'radar_actions',
  'radar_outreach_drafts',
  'radar_search_usage',
  // 016
  'radar_reports',
  'radar_changes',
]
// 015 varsayılanları (supabase/migrations/20261022001500_leonx_radar.sql ile aynı)
const RADAR_DEFAULTS = {
  radar_sources: { url: null, allowed_hosts: [], sector_hint: null, region_hint: null, permission_status: 'inceleniyor', permission_note: null, permission_checked_at: null, interval_minutes: 60, max_items: 50, active: false, last_run_at: null, last_status: null, last_error: null, consecutive_failures: 0, next_run_at: null, last_test_at: null },
  radar_opportunities: { city: null, district: null, is_ankara: false, sector: 'bilinmiyor', project_type: null, stage: 'bilinmiyor', tender: {}, deadline: null, score: 0, score_breakdown: [], reliability: 0, reliability_base: 0, reliability_breakdown: [], verified_need: false, label: 'belirsiz', risks: [], status: 'yeni', status_note: null, next_action: null, cluster_tokens: [], notified_at: null, crm_company_id: null, project_id: null, notes: null },
  radar_companies: { website: null, website_verified: false, website_source: null, crm_company_id: null, notes: null },
  radar_opportunity_companies: { role: 'bilinmiyor', verified: false, evidence_item_id: null },
  radar_opportunity_categories: { matched_terms: [], evidence_item_id: null },
  radar_outreach_drafts: { company_id: null, contact_id: null, status: 'taslak' },
  radar_categories: { active: true, extra_keywords: [] },
  radar_items: { pending: false, opportunity_id: null, published_at: null },
}
const RADAR_UPDATABLE = {
  radar_settings: ['weights', 'home_city', 'min_score', 'high_priority_score', 'notify_categories', 'notify_cities', 'digest_hour', 'quiet_start', 'quiet_end', 'critical_enabled', 'capability_text', 'search_api_enabled', 'search_monthly_limit', 'search_daily_limit', 'search_queries_per_run'],
  radar_categories: ['active', 'extra_keywords'],
  radar_sources: ['name', 'kind', 'url', 'allowed_hosts', 'sector_hint', 'region_hint', 'permission_status', 'permission_note', 'permission_checked_at', 'interval_minutes', 'max_items', 'active'],
  radar_opportunities: ['status', 'status_note', 'next_action', 'notes'],
  radar_companies: ['website', 'website_verified', 'website_source', 'notes'],
  radar_opportunity_companies: ['role', 'verified'],
}
const RADAR_SETTINGS_DEFAULT = {
  singleton: true, weights: { kategori: 25, dogrulama: 25, asama: 15, yakinlik: 15, iletisim: 10, ticari: 10 }, home_city: 'Ankara', min_score: 60, high_priority_score: 75,
  notify_categories: [], notify_cities: [], digest_hour: null, quiet_start: null, quiet_end: null, critical_enabled: true, capability_text: null,
  search_api_enabled: false, search_monthly_limit: 900, search_daily_limit: 30, search_queries_per_run: 2,
}
const RADAR_CATEGORIES = [
  ['celik_kapi', 'Çelik kapı', 'kapi'], ['yangin_kapisi', 'Yangın kapısı', 'kapi'], ['oda_kapisi', 'Oda kapısı', 'kapi'], ['teknik_kapi', 'Teknik kapı', 'kapi'],
  ['kurumsal_bina_kapi', 'Otel / hastane / okul / ticari bina kapı işleri', 'kapi'], ['aluminyum_dograma', 'Alüminyum doğrama', 'aluminyum_pvc'],
  ['pvc_dograma', 'PVC doğrama', 'aluminyum_pvc'], ['giydirme_cephe', 'Giydirme cephe', 'aluminyum_pvc'], ['cam_cephe', 'Cam cephe', 'aluminyum_pvc'],
  ['metal_korkuluk', 'Metal korkuluk', 'metal'], ['ozel_metal_imalat', 'Özel metal imalat', 'metal'],
]
// Faz 7: aşama → eski durum ve asgari ilerleme (supabase/migrations/20261014000700_leonx_workflow.sql ile aynı)
const STAGE_STATUS = { yeni_firsat: 'kesif', teklif_hazirlaniyor: 'teklif', teklif_gonderildi: 'teklif', gorusme: 'teklif', onaylandi: 'teklif', olcu_kesif: 'olcu', uretime_hazirlik: 'tasarim', uretimde: 'uretim', montajda: 'montaj', tamamlandi: 'tamamlandi', teslim_edildi: 'tamamlandi', iptal: 'iptal' }
const STATUS_STAGE = { kesif: 'olcu_kesif', olcu: 'olcu_kesif', tasarim: 'uretime_hazirlik', teklif: 'teklif_hazirlaniyor', uretim: 'uretimde', montaj: 'montajda', tamamlandi: 'tamamlandi', iptal: 'iptal', beklemede: 'gorusme' }
const STAGE_PROGRESS = { yeni_firsat: 0, teklif_hazirlaniyor: 5, teklif_gonderildi: 10, gorusme: 15, onaylandi: 25, olcu_kesif: 30, uretime_hazirlik: 40, uretimde: 55, montajda: 80, tamamlandi: 100, teslim_edildi: 100, iptal: 0 }
const STAGE_LABEL = { yeni_firsat: 'Yeni fırsat', teklif_hazirlaniyor: 'Teklif hazırlanıyor', teklif_gonderildi: 'Teklif gönderildi', gorusme: 'Görüşme aşamasında', onaylandi: 'Onaylandı', olcu_kesif: 'Ölçü / keşif', uretime_hazirlik: 'Üretime hazırlık', uretimde: 'Üretimde', montajda: 'Montajda', tamamlandi: 'Tamamlandı', teslim_edildi: 'Teslim edildi', iptal: 'İptal edildi' }
const PREFS_DEFAULTS = { in_app: true, push: false, cat_proje: true, cat_teklif: true, cat_cad: true, cat_gorev: true, cat_termin: true, cat_sistem: true, cat_firsat: true, own_actions: true }
/** Gönderilmiş teklifte değişebilen alanlar (supabase/migrations/20261013000600_leonx_quotes.sql ile aynı) */
const QUOTE_FREE = ['status', 'superseded', 'sent_at', 'decided_at', 'internal_notes', 'project_id']
const QUOTE_DEFAULTS = {
  superseded: false, contact_id: null, project_id: null, scope: null, status: 'taslak', valid_until: null, currency: 'TRY', pricing_mode: 'detayli',
  lump_sum: null, lump_cost: null, waste_pct: 0, overhead_pct: 0, profit_pct: 0, shipping_amount: 0, other_amount: 0, other_label: null,
  discount_kind: 'yok', discount_value: 0, vat_pct: 20, hide_unit_prices: false, payment_terms: null, delivery_terms: null, notes: null,
  internal_notes: null, sent_at: null, decided_at: null, revision: 1,
}
const ITEM_DEFAULTS = {
  sort_order: 0, poz_code: null, system_type: null, width_mm: null, height_mm: null, dim_unit: 'mm', quantity: 1, unit: 'adet', manual_measure: null,
  material_cost: 0, labor_cost: 0, install_cost: 0, other_cost: 0, unit_price: null, notes: null, source: 'elle', source_item_id: null,
  source_takeoff_id: null, source_label: null, measure_verified: true,
}
const SETTINGS_DEFAULTS = {
  legal_name: null, address: null, phone: null, email: null, website: null, tax_office: null, tax_number: null, bank_name: null, iban: null,
  quote_prefix: 'TKL', default_validity_days: 15, default_vat_pct: 20, default_currency: 'TRY', default_payment_terms: null,
  default_delivery_terms: null, closing_text: null,
}
const guardError = (message) => ({ error: { status: 400, code: '23514', message } })
const uniqueError = (name) => ({ error: { status: 409, code: '23505', message: `duplicate key value violates unique constraint "${name}"` } })
// Faz 8 varsayılanları (supabase/migrations/20261015001100_leonx_finance.sql ile aynı)
const FIN_DEFAULTS = {
  cost_rates: { currency: 'TRY', quantity_category: null, active: true, notes: null },
  fx_rates: { project_id: null },
  project_budgets: { currency: 'TRY', sale_net_amount: null, vat_pct: 20, source_quote_id: null, quote_snapshot_net: null, quote_snapshot_currency: null, quote_snapshot_vat_pct: null, quote_snapshot_label: null, quote_snapshot_at: null, waste_pct: 0, overhead_pct: 0, notes: null },
  project_cost_lines: { sort_order: 0, unit_cost: null, currency: 'TRY', source: 'elle', source_takeoff_id: null, source_item_id: null, cost_rate_id: null, measure_basis: null, notes: null },
  project_expenses: { supplier: null, vat_amount: 0, currency: 'TRY', fx_rate_to_base: null, fx_to_currency: null, document_no: null, paid: false, notes: null },
  project_payment_schedule: { kind: 'taksit', label: null, currency: 'TRY', sort_order: 0, notes: null },
  project_collections: { currency: 'TRY', method: 'havale', schedule_id: null, reference: null, note: null },
}
const MATERIAL_GROUPS = ['profil', 'pvc_sistem', 'cam', 'aksesuar']
const cents = (x) => Math.round(Number(x) * 100)
const fmt2 = (c) => (c / 100).toFixed(2)

export class MockSupabase {
  constructor() {
    this.db = Object.fromEntries(TABLES.map((t) => [t, []]))
    this.storage = new Map()
    this.sockets = new Set()
    this.channelSeq = 1
    this.historySeq = 1
    this.requests = []
    this.failNext = null
    this.quoteCounter = {}
    this.copyNote = null
    this.eventSeq = 1
    /** Testte push sunucusunun açık anahtarı (null: sunucu henüz hazır değil) */
    this.vapidPublic = null
    this.radarActionSeq = 1
    /** Radar Edge Function'ları dağıtıldı mı (false: 404 — "dağıtılmadı" açıklaması sınanır) */
    this.radarFunctionsDeployed = false
    this.functionCalls = []
    this.db.radar_settings.push({ id: randomUUID(), ...RADAR_SETTINGS_DEFAULT, created_at: this.now(), updated_at: this.now(), version: 1 })
    RADAR_CATEGORIES.forEach(([key, name, group_key], i) => this.db.radar_categories.push({ key, id: randomUUID(), name, group_key, sort_order: (i + 1) * 10, active: true, extra_keywords: [], version: 1 }))
  }

  // ---------------------------------------------------------------- Faz 7 tetikleyici karşılıkları
  syncStage(row, old) {
    if (!old) {
      if (row.stage === 'yeni_firsat' && row.status && row.status !== 'kesif') row.stage = STATUS_STAGE[row.status]
    } else if (row.stage === old.stage && row.on_hold === old.on_hold && row.status !== old.status) {
      if (row.status === 'beklemede') row.on_hold = true
      else {
        row.on_hold = false
        if (STAGE_STATUS[old.stage] !== row.status) row.stage = STATUS_STAGE[row.status]
      }
    }
    row.status = row.on_hold && !['tamamlandi', 'teslim_edildi', 'iptal'].includes(row.stage) ? 'beklemede' : STAGE_STATUS[row.stage]
    row.progress = Math.max(Number(row.progress ?? 0), STAGE_PROGRESS[row.stage] ?? 0)
    if (['tamamlandi', 'teslim_edildi'].includes(row.stage) && !row.completed_on) row.completed_on = this.now().slice(0, 10)
    return row
  }

  event(projectId, kind, title, detail, refType, refId, actor, dedupe = null) {
    if (!projectId) return
    if (dedupe && this.db.project_events.some((e) => e.dedupe_key === dedupe)) return
    const row = { id: this.eventSeq++, project_id: projectId, kind, title, detail: detail ?? null, ref_type: refType, ref_id: refId, actor, created_at: this.now(), dedupe_key: dedupe }
    this.db.project_events.push(row)
    this.broadcast('project_events', 'INSERT', row, null)
  }

  notify(category, kind, title, body, link, entityType, entityId, dedupe, actor, system = false) {
    const prefs = this.db.notification_prefs.find((x) => x.user_id === OWNER.id) ?? PREFS_DEFAULTS
    if (!prefs.in_app || !prefs[`cat_${category}`]) return
    if (!system && !prefs.own_actions && actor === OWNER.id) return
    if (this.db.notifications.some((n) => n.dedupe_key === dedupe)) return
    const push = prefs.push && this.db.push_subscriptions.some((x) => !x.disabled_at)
    const row = { id: randomUUID(), user_id: OWNER.id, category, kind, title: String(title).slice(0, 200), body: body ?? null, link, entity_type: entityType, entity_id: entityId, dedupe_key: dedupe, actor: system ? null : actor, read_at: null, push_state: push ? 'bekliyor' : 'yok', push_attempts: 0, created_at: this.now() }
    this.db.notifications.push(row)
    this.broadcast('notifications', 'INSERT', row, null)
  }

  afterInsert(table, row, actor) {
    if (table === 'companies') this.notify('proje', 'musteri_yeni', `Yeni müşteri: ${row.name}`, null, `/firmalar/${row.id}`, 'company', row.id, `company:${row.id}:yeni`, actor)
    if (table === 'projects') {
      this.event(row.id, 'proje_olustu', 'Proje oluşturuldu', STAGE_LABEL[row.stage], 'project', row.id, actor, `project:${row.id}:yeni`)
      this.notify('proje', 'proje_yeni', `Yeni proje: ${row.code} · ${row.name}`, null, `/projeler/${row.id}`, 'project', row.id, `project:${row.id}:yeni`, actor)
    }
    if (table === 'project_files') {
      this.event(row.project_id, 'dosya', 'Dosya yüklendi', row.file_name, 'project_file', row.id, actor, `file:${row.id}`)
      const cad = /\.(dxf|dwg|pdf)$/i.test(row.file_name)
      this.notify('proje', cad ? 'cad_dosya' : 'dosya_yeni', `${cad ? 'CAD / çizim dosyası yüklendi: ' : 'Yeni dosya: '}${row.file_name}`, null, `/projeler/${row.project_id}`, 'project', row.project_id, `file:${row.id}`, actor)
    }
    if (table === 'cad_analyses') {
      this.event(row.project_id, 'cad_analiz', 'CAD analizi kaydedildi', `${row.file_name} · ${row.candidate_count ?? 0} aday`, 'cad_analysis', row.id, actor, `cad:${row.id}`)
      this.notify('cad', 'cad_tamam', `CAD analizi tamamlandı: ${row.file_name}`, null, `/projeler/${row.project_id}`, 'project', row.project_id, `cad:${row.id}`, actor)
      const conflicts = Number(row.summary?.tespit?.celiski ?? 0)
      if (conflicts > 0) {
        this.event(row.project_id, 'cad_celiski', 'Ölçü / adet çelişkisi bulundu', `${row.file_name} · ${conflicts} poz`, 'cad_analysis', row.id, actor, `cad:${row.id}:celiski`)
        this.notify('cad', 'cad_celiski', `Çelişki bulundu: ${row.file_name}`, `${conflicts} pozda çizelge, plan veya görünüş birbiriyle uyuşmuyor; karar sizin`, `/projeler/${row.project_id}`, 'project', row.project_id, `cad:${row.id}:celiski`, actor)
      }
      if (row.status !== 'hatali' && row.candidate_count > 0) this.notify('cad', 'metraj_dogrulama', `Metraj doğrulama bekliyor: ${row.file_name}`, `${row.candidate_count} poz adayı mühendislik incelemesi bekliyor`, `/projeler/${row.project_id}`, 'project', row.project_id, `cad:${row.id}:dogrulama`, actor)
    }
    if (table === 'quantity_takeoffs') {
      this.event(row.project_id, 'metraj', row.revision > 1 ? 'Metraj revize edildi' : 'Metraj hazırlandı', `Rev ${row.revision} · ${row.name}`, 'takeoff', row.id, actor, `takeoff:${row.id}`)
      this.notify('cad', row.revision > 1 ? 'metraj_revize' : 'metraj_yeni', `${row.revision > 1 ? 'Metraj revize edildi' : 'Metraj hazırlandı'}: Rev ${row.revision}`, row.name, `/metraj?proje=${row.project_id}&surum=${row.id}`, 'project', row.project_id, `takeoff:${row.id}`, actor)
    }
    if (table === 'quotes') {
      this.event(row.project_id, 'teklif', row.revision > 1 ? 'Teklif revizyonu eklendi' : 'Teklif eklendi', `${row.quote_no} Rev ${row.revision} · ${row.title}`, 'quote', row.id, actor, `quote:${row.id}:yeni`)
      this.notify('teklif', 'teklif_yeni', `${row.revision > 1 ? 'Teklif revizyonu' : 'Teklif oluşturuldu'}: ${row.quote_no} Rev ${row.revision}`, row.title, `/teklifler/${row.id}`, 'quote', row.id, `quote:${row.id}:yeni`, actor)
    }
    if (table === 'project_expenses') {
      this.event(row.project_id, 'gider', 'Gider kaydedildi', `${row.description} · ${fmt2(cents(row.amount))} ${row.currency} (KDV hariç)`, 'expense', row.id, actor, `expense:${row.id}`)
      this.budgetCheck(row.project_id)
    }
    if (table === 'project_collections') this.event(row.project_id, 'tahsilat', 'Tahsilat kaydedildi', `${fmt2(cents(row.amount))} ${row.currency}`, 'collection', row.id, actor, `collection:${row.id}`)
    if (table === 'project_tasks') {
      this.event(row.project_id, 'gorev_eklendi', 'Görev eklendi', row.title, 'task', row.id, actor, `task:${row.id}:yeni`)
      if (row.done) this.event(row.project_id, 'gorev_tamam', 'Görev tamamlandı', row.title, 'task', row.id, actor, `task:${row.id}:tamam:${row.done_at}`)
    }
  }

  afterUpdate(table, old, next, actor) {
    if (table === 'projects') {
      if (next.stage !== old.stage) {
        this.event(next.id, 'asama', STAGE_LABEL[next.stage], `${STAGE_LABEL[old.stage]} → ${STAGE_LABEL[next.stage]}`, 'project', next.id, actor)
        this.notify('proje', 'proje_asama', `${next.code} · ${next.name}: ${STAGE_LABEL[next.stage]}`, `${STAGE_LABEL[old.stage]} → ${STAGE_LABEL[next.stage]}`, `/projeler/${next.id}`, 'project', next.id, `project:${next.id}:asama:${next.stage}:${this.now().slice(0, 16)}`, actor)
      }
      if (next.on_hold !== old.on_hold) this.event(next.id, 'beklemede', next.on_hold ? 'Beklemeye alındı' : 'Beklemeden çıkarıldı', null, 'project', next.id, actor)
    }
    if (table === 'quotes' && next.status !== old.status && ['gonderildi', 'kabul', 'red'].includes(next.status)) {
      const label = { gonderildi: 'Teklif gönderildi', kabul: 'Teklif kabul edildi', red: 'Teklif reddedildi' }[next.status]
      this.event(next.project_id, `teklif_${next.status}`, label, `${next.quote_no} Rev ${next.revision} · ${next.title}`, 'quote', next.id, actor, `quote:${next.id}:${next.status}`)
      this.notify('teklif', `teklif_${next.status}`, `${label}: ${next.quote_no} Rev ${next.revision}`, next.title, next.status === 'kabul' && next.project_id ? `/projeler/${next.project_id}` : `/teklifler/${next.id}`, 'quote', next.id, `quote:${next.id}:${next.status}`, actor)
    }
    if (table === 'quantity_takeoffs' && next.status === 'onaylandi' && old.status !== 'onaylandi') {
      this.event(next.project_id, 'metraj_onay', 'Metraj onaylandı', `Rev ${next.revision} · ${next.name}`, 'takeoff', next.id, actor, `takeoff:${next.id}:onay`)
      this.notify('cad', 'metraj_onay', `Metraj onaylandı: Rev ${next.revision}`, next.name, `/metraj?proje=${next.project_id}&surum=${next.id}`, 'project', next.project_id, `takeoff:${next.id}:onay`, actor)
    }
    if (table === 'project_expenses') this.budgetCheck(next.project_id)
    if (table === 'project_tasks' && next.done && !old.done) {
      this.event(next.project_id, 'gorev_tamam', 'Görev tamamlandı', next.title, 'task', next.id, actor, `task:${next.id}:tamam:${next.done_at}`)
    }
  }

  // ---------------------------------------------------------------- Faz 8 tetikleyici karşılıkları
  /** public.leonx_fx_rate: projeye özel > genel, tarih ≤ gün, ters yön yok */
  fxRate(from, to, date, projectId) {
    if (from === to) return 1
    const c = this.db.fx_rates
      .filter((r) => r.from_currency === from && r.to_currency === to && r.rate_date <= date && (r.project_id === null || r.project_id === projectId))
      .sort((a, b) => (b.project_id ? 1 : 0) - (a.project_id ? 1 : 0) || (a.rate_date < b.rate_date ? 1 : a.rate_date > b.rate_date ? -1 : 0) || (a.created_at < b.created_at ? 1 : -1))
    return c[0] ? Number(c[0].rate) : null
  }

  /** public.project_receivables karşılığı (FIFO) */
  receivables() {
    const out = []
    const linked = new Map()
    const pool = new Map()
    const key = (p, c) => `${p}|${c}`
    const ids = new Set(this.db.project_payment_schedule.map((s) => s.id))
    for (const c of this.db.project_collections) {
      if (c.schedule_id && ids.has(c.schedule_id)) linked.set(c.schedule_id, (linked.get(c.schedule_id) ?? 0) + cents(c.amount))
      else pool.set(key(c.project_id, c.currency), (pool.get(key(c.project_id, c.currency)) ?? 0) + cents(c.amount))
    }
    const rows = this.db.project_payment_schedule.map((s) => {
      const amount = cents(s.amount)
      const l = linked.get(s.id) ?? 0
      if (l > amount) pool.set(key(s.project_id, s.currency), (pool.get(key(s.project_id, s.currency)) ?? 0) + l - amount)
      return { s, amount, applied: Math.min(l, amount) }
    })
    rows.sort((a, b) => (a.s.due_date < b.s.due_date ? -1 : a.s.due_date > b.s.due_date ? 1 : a.s.sort_order - b.s.sort_order || (a.s.id < b.s.id ? -1 : 1)))
    const today = this.now().slice(0, 10)
    for (const r of rows) {
      const k = key(r.s.project_id, r.s.currency)
      const avail = pool.get(k) ?? 0
      const take = Math.min(r.amount - r.applied, avail)
      pool.set(k, avail - take)
      const collected = r.applied + take
      const outstanding = r.amount - collected
      out.push({ ...r.s, collected, outstanding, status: outstanding === 0 ? 'tahsil_edildi' : r.s.due_date < today ? 'gecikti' : collected > 0 ? 'kismi' : 'bekliyor' })
    }
    return out
  }

  /** public.leonx_finance_budget_check karşılığı */
  budgetCheck(projectId) {
    const b = this.db.project_budgets.find((x) => x.project_id === projectId)
    const base = b?.currency ?? 'TRY'
    const lines = this.db.project_cost_lines.filter((l) => l.project_id === projectId)
    if (!lines.length) return
    const today = this.now().slice(0, 10)
    let direct = 0
    let material = 0
    for (const l of lines) {
      if (l.unit_cost == null) return
      const rate = this.fxRate(l.currency, base, today, projectId)
      if (rate == null) return
      const amt = Math.round((Math.round(Number(l.quantity) * 1000) * cents(l.unit_cost)) / 1000)
      const conv = Math.round(amt * rate)
      direct += conv
      if (MATERIAL_GROUPS.includes(l.cost_group)) material += conv
    }
    const waste = Math.round((material * Number(b?.waste_pct ?? 0)) / 100)
    const est = direct + waste + Math.round(((direct + waste) * Number(b?.overhead_pct ?? 0)) / 100)
    if (est <= 0) return
    let act = 0
    for (const e of this.db.project_expenses.filter((x) => x.project_id === projectId)) {
      const rate = e.currency === base ? 1 : e.fx_rate_to_base != null && e.fx_to_currency === base ? Number(e.fx_rate_to_base) : this.fxRate(e.currency, base, e.expense_date, projectId)
      if (rate != null) act += Math.round(cents(e.amount) * rate)
    }
    if (act <= est) return
    const step = Math.floor(((act - est) * 10) / est)
    const p = this.db.projects.find((x) => x.id === projectId)
    const detail = `Gerçekleşen gider ${fmt2(act)} ${base} · tahmini maliyet ${fmt2(est)} ${base}`
    const dedupe = `butce-asildi:${projectId}:${step}`
    this.event(projectId, 'butce_asildi', 'Bütçe aşıldı', detail, 'project', projectId, null, dedupe)
    this.notify('proje', 'butce_asildi', `Bütçe aşıldı: ${p?.code ?? ''}`, detail, `/projeler/${projectId}?sekme=finans`, 'project', projectId, dedupe, null, true)
  }

  /** Faz 8 bütünlük kuralları (tetikleyici, kısıt ve benzersiz indeks karşılıkları); hata yoksa null */
  financeGuard(table, row, old) {
    if (old && row.project_id !== old.project_id) return guardError('Kayıt başka projeye taşınamaz')
    if (table === 'cost_rates') {
      if (!(Number(row.unit_cost) > 0)) return guardError('cost_rates_unit_cost_check')
      if (this.db.cost_rates.some((r) => r.id !== row.id && r.code === row.code && r.valid_from === row.valid_from)) return uniqueError('cost_rates_code_valid_unique')
    }
    if (table === 'fx_rates') {
      if (row.from_currency === row.to_currency) return guardError('fx_rates_pair_check')
      if (this.db.fx_rates.some((r) => r.id !== row.id && r.rate_date === row.rate_date && r.from_currency === row.from_currency && r.to_currency === row.to_currency && (r.project_id ?? null) === (row.project_id ?? null))) return uniqueError('fx_rates_unique_idx')
    }
    if (table === 'project_budgets') {
      if (!old && this.db.project_budgets.some((r) => r.project_id === row.project_id)) return uniqueError('project_budgets_project_id_key')
      if (row.source_quote_id && (!old || old.source_quote_id !== row.source_quote_id)) {
        const q = this.db.quotes.find((x) => x.id === row.source_quote_id)
        if (!q || q.project_id !== row.project_id) return guardError('Teklif bu projeye bağlı değil')
        if (q.status !== 'kabul') return guardError('Bütçe yalnız kabul edilmiş teklife bağlanabilir')
      }
    }
    if (table === 'project_cost_lines') {
      if (!(Number(row.quantity) > 0)) return guardError('project_cost_lines_quantity_check')
      if (row.source !== 'metraj') {
        if (row.source_item_id || row.source_takeoff_id) return guardError('Metraj bağlantısı yalnız metraj kaynaklı satırda olabilir')
      } else if (!old || old.source_item_id !== row.source_item_id || old.source_takeoff_id !== row.source_takeoff_id) {
        const t = this.db.quantity_takeoffs.find((x) => x.id === row.source_takeoff_id)
        if (!t || t.project_id !== row.project_id) return guardError('Metraj sürümü bu projeye ait değil')
        if (t.status !== 'onaylandi') return guardError('Yalnız onaylanmış metraj sürümü maliyete aktarılabilir')
        const it = this.db.quantity_items.find((x) => x.id === row.source_item_id)
        if (!it || it.takeoff_id !== t.id) return guardError('Poz bu metraj sürümüne ait değil')
        if (it.verification !== 'onaylandi') return guardError('Doğrulanmamış veya reddedilmiş poz maliyete aktarılamaz')
        if (this.db.project_cost_lines.some((l) => l.id !== row.id && l.project_id === row.project_id && l.source === 'metraj' && l.source_takeoff_id && l.source_takeoff_id !== row.source_takeoff_id)) {
          return guardError('Bu projeye başka bir metraj revizyonu aktarılmış; çift sayımı önlemek için önce o satırları kaldırın')
        }
      }
      if (row.source_item_id && this.db.project_cost_lines.some((l) => l.id !== row.id && l.project_id === row.project_id && l.source_item_id === row.source_item_id && l.cost_group === row.cost_group)) {
        return uniqueError('project_cost_lines_source_unique')
      }
    }
    if (table === 'project_expenses') {
      if (!(Number(row.amount) > 0)) return guardError('project_expenses_amount_check')
      if ((row.fx_rate_to_base == null) !== (row.fx_to_currency == null)) return guardError('project_expenses_fx_check')
      if (row.document_no && this.db.project_expenses.some((e) => e.id !== row.id && e.project_id === row.project_id && (e.supplier ?? '').toLowerCase() === (row.supplier ?? '').toLowerCase() && (e.document_no ?? '').toLowerCase() === row.document_no.toLowerCase())) {
        return uniqueError('project_expenses_document_unique')
      }
    }
    if (table === 'project_payment_schedule' && !(Number(row.amount) > 0)) return guardError('project_payment_schedule_amount_check')
    if (table === 'project_collections') {
      if (!(Number(row.amount) > 0)) return guardError('project_collections_amount_check')
      if (row.schedule_id) {
        const s = this.db.project_payment_schedule.find((x) => x.id === row.schedule_id)
        if (!s || s.project_id !== row.project_id) return guardError('Taksit bu projeye ait değil')
        if (s.currency !== row.currency) return guardError('Tahsilat, bağlandığı taksitle aynı para biriminde olmalıdır')
      }
    }
    return null
  }

  /** public.leonx_run_reminders karşılığı (tekilleştirilmiş) */
  runReminders() {
    const today = this.now().slice(0, 10)
    const before = this.db.notifications.length
    const plus = (d, n) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10)
    for (const t of this.db.project_tasks.filter((x) => !x.done)) {
      const p = this.db.projects.find((x) => x.id === t.project_id)
      const link = `/projeler/${t.project_id}?sekme=gorevler`
      if (t.remind_at && t.remind_at <= this.now()) this.notify('gorev', 'gorev_hatirlatma', `Görev zamanı: ${t.title}`, p?.code ?? null, link, 'task', t.id, `task:${t.id}:hatirlatma:${t.remind_at.slice(0, 16)}`, null, true)
      if (t.due_date === today) this.notify('gorev', 'gorev_bugun', `Bugün bitmesi gereken görev: ${t.title}`, p?.code ?? null, link, 'task', t.id, `task:${t.id}:bugun:${t.due_date}`, null, true)
      if (t.due_date && t.due_date < today) this.notify('gorev', 'gorev_gecikti', `Görev gecikti: ${t.title}`, p?.code ?? null, link, 'task', t.id, `task:${t.id}:gecikti:${t.due_date}`, null, true)
    }
    for (const p of this.db.projects.filter((x) => x.due_date && !['tamamlandi', 'teslim_edildi', 'iptal'].includes(x.stage))) {
      if (p.due_date >= today && p.due_date <= plus(today, 3)) this.notify('termin', 'teslim_yaklasiyor', `Teslim tarihi yaklaşıyor: ${p.code}`, p.name, `/projeler/${p.id}`, 'project', p.id, `project:${p.id}:termin:${p.due_date}`, null, true)
    }
    for (const q of this.db.quotes.filter((x) => x.valid_until && !x.superseded && ['gonderildi', 'gorusmede'].includes(x.status))) {
      if (q.valid_until >= today && q.valid_until <= plus(today, 2)) this.notify('teklif', 'teklif_suresi', `Teklif geçerliliği bitiyor: ${q.quote_no}`, q.title, `/teklifler/${q.id}`, 'quote', q.id, `quote:${q.id}:gecerlilik:${q.valid_until}`, null, true)
    }
    // Faz 8: tahsilat vadesi yaklaşıyor / gecikti
    for (const r of this.receivables().filter((x) => x.outstanding > 0 && x.due_date >= plus(today, -90) && x.due_date <= plus(today, 3))) {
      const p = this.db.projects.find((x) => x.id === r.project_id)
      if (!p || p.stage === 'iptal') continue
      const body = `${r.label ? `${r.label} · ` : ''}${fmt2(r.outstanding)} ${r.currency}`
      const link = `/projeler/${r.project_id}?sekme=finans`
      if (r.due_date >= today) this.notify('termin', 'tahsilat_yaklasiyor', `Tahsilat vadesi yaklaşıyor: ${p.code}`, body, link, 'project', r.project_id, `tahsilat-yaklasiyor:${r.id}:${r.due_date}`, null, true)
      else this.notify('termin', 'tahsilat_gecikti', `Tahsilat gecikti: ${p.code}`, body, link, 'project', r.project_id, `tahsilat-gecikti:${r.id}`, null, true)
    }
    return this.db.notifications.length - before
  }

  // ---------------------------------------------------------------- yardımcılar
  userFromAuth(headers) {
    const auth = headers['authorization'] || ''
    const token = auth.replace(/^Bearer\s+/i, '')
    const parts = token.split('.')
    if (parts.length !== 3) return null
    try {
      const p = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
      return [OWNER, INTRUDER].find((u) => u.id === p.sub) ?? null
    } catch {
      return null
    }
  }

  isOwner(user) {
    return user?.id === OWNER.id
  }

  now() {
    return new Date().toISOString()
  }

  /** Sunucu tarafı tetikleyicilerin karşılığı: id, zaman damgaları, sürüm, durum geçmişi */
  insertRow(table, input, actor = OWNER.id, system = false) {
    const now = this.now()
    let row
    if (table === 'radar_actions') {
      row = { id: this.radarActionSeq++, created_at: now, created_by: actor, note: null, from_status: null, ...input }
    } else if (table === 'project_status_history' || table === 'quantity_item_history' || table === 'quote_history') {
      row = { id: this.historySeq++, changed_at: now, changed_by: actor, ...input }
    } else {
      // İstemcinin ürettiği UUID kabul edilir (idempotent yeniden deneme); aynı id ikinci kez eklenemez
      const id = input.id ?? randomUUID()
      if (this.db[table].some((r) => r.id === id)) return { error: { status: 409, code: '23505', message: `duplicate key value violates unique constraint "${table}_pkey"` } }
      row = { ...input, id, created_by: actor, created_at: now, updated_at: now, version: 1 }
    }
    if (table === 'quantity_takeoffs') {
      if (row.status && row.status !== 'taslak') return guardError('Yeni metraj sürümü taslak olarak oluşturulur')
      row = { status: 'taslak', based_on: null, analysis_id: null, notes: null, approved_at: null, approved_by: null, ...row }
      if (this.db.quantity_takeoffs.some((t) => t.project_id === row.project_id && t.revision === row.revision)) {
        return { error: { status: 409, code: '23505', message: 'duplicate key value violates unique constraint "quantity_takeoffs_revision_unique"' } }
      }
    }
    if (table === 'quantity_items') {
      const t = this.db.quantity_takeoffs.find((x) => x.id === row.takeoff_id)
      if (!t) return { error: { status: 409, code: '23503', message: 'Metraj sürümü bulunamadı' } }
      if (t.status !== 'taslak') return guardError('Onaylanmış veya arşivlenmiş metraj sürümü değiştirilemez; yeni sürüm oluşturun')
      row.project_id = t.project_id
      // 012: ilk değerler ve onay bilgisi sunucuda yazılır
      row = { uncertain: false, review_note: null, ...row }
      const d = row.detection?.detected ?? {}
      row.original = row.detection
        ? { poz_code: d.poz_code ?? row.poz_code, category: d.category ?? row.category, shape: row.shape ?? 'dikdortgen', width_mm: 'width_mm' in d ? d.width_mm : (row.width_mm ?? null), height_mm: 'height_mm' in d ? d.height_mm : (row.height_mm ?? null), quantity: d.quantity ?? row.quantity ?? 1, unit: row.unit ?? 'm2', verification: row.verification ?? 'bekliyor' }
        : null
      const ok = row.verification === 'onaylandi'
      row.approved_by = ok ? actor : null
      row.approved_at = ok ? now : null
      if (ok) row.uncertain = false
    }
    if (table === 'quote_settings') row = { ...SETTINGS_DEFAULTS, ...row }
    if (RADAR_DEFAULTS[table]) row = { ...RADAR_DEFAULTS[table], ...row }
    if (table === 'radar_opportunities') row = { first_seen_at: now, last_updated_at: now, ...row }
    if (table === 'radar_sources') {
      if (row.interval_minutes < 30) return guardError('radar_sources_interval_minutes_check')
      if (row.url && /(^|\.)(ekap\.kik\.gov\.tr|ilan\.gov\.tr)(\/|$)/i.test(new URL(row.url).hostname + '/') && (row.kind !== 'manual' || row.permission_status === 'izinli')) return guardError('radar_sources_no_scrape')
    }
    if (table === 'radar_contacts' && (!row.source_url || !row.verified_at)) return { error: { status: 400, code: '23502', message: 'null value violates not-null constraint' } }
    if (table === 'quotes') {
      row = { ...QUOTE_DEFAULTS, ...row }
      if (row.status !== 'taslak') return guardError('Yeni teklif veya revizyon taslak olarak oluşturulur')
      if (row.valid_until && row.valid_until < row.quote_date) return guardError('quotes_validity_check')
      row.quote_date = row.quote_date ?? this.now().slice(0, 10)
      row.superseded = false
      row.sent_at = null
      row.decided_at = null
      if (row.revision === 1) {
        const year = Number(row.quote_date.slice(0, 4))
        this.quoteCounter[year] = (this.quoteCounter[year] ?? 0) + 1
        const prefix = this.db.quote_settings[0]?.quote_prefix ?? 'TKL'
        row.root_id = row.id
        row.quote_no = `${prefix}-${year}-${String(this.quoteCounter[year]).padStart(4, '0')}`
      } else {
        const root = this.db.quotes.find((q) => q.id === row.root_id && q.revision === 1)
        if (!root) return { error: { status: 409, code: '23503', message: 'Revizyonun bağlı olduğu teklif bulunamadı' } }
        row.quote_no = root.quote_no
        if (this.db.quotes.some((q) => q.root_id === row.root_id && q.revision === row.revision)) return { error: { status: 409, code: '23505', message: 'duplicate key value violates unique constraint "quotes_root_revision_unique"' } }
      }
    }
    if (table === 'quote_items') {
      row = { ...ITEM_DEFAULTS, ...row }
      const q = this.db.quotes.find((x) => x.id === row.quote_id)
      if (!q) return { error: { status: 409, code: '23503', message: 'Teklif bulunamadı' } }
      if (!system && (q.superseded || q.status !== 'taslak')) return guardError('Gönderilmiş veya eski revizyon teklifin kalemleri değiştirilemez; revizyon oluşturun')
      if (!(Number(row.quantity) > 0)) return guardError('quote_items_quantity_check')
    }
    if (table === 'projects') {
      row = { status: 'kesif', stage: 'yeni_firsat', progress: 0, on_hold: false, completed_on: null, address: null, map_url: null, priority: 'normal', company_id: null, description: null, start_date: null, due_date: null, location: null, notes: null, ...row }
      if (this.db.projects.some((p) => p.code === row.code)) return { error: { status: 409, code: '23505', message: 'duplicate key value violates unique constraint "projects_code_key"' } }
      if (row.progress > 100 || row.progress < 0) return guardError('projects_progress_check')
      row = this.syncStage(row, null)
    }
    if (table === 'project_tasks') {
      if (!this.db.projects.some((p) => p.id === row.project_id)) return { error: { status: 409, code: '23503', message: 'Proje bulunamadı' } }
      row = { description: null, priority: 'normal', start_date: null, due_date: null, remind_at: null, done: false, done_at: null, notes: null, sort_order: 0, ...row }
      row.done_at = row.done ? this.now() : null
    }
    if (table === 'notification_prefs') {
      if (this.db.notification_prefs.some((x) => x.user_id === actor)) return { error: { status: 409, code: '23505', message: 'duplicate key value violates unique constraint "notification_prefs_pkey"' } }
      row = { ...PREFS_DEFAULTS, ...row, user_id: actor }
    }
    if (FIN_DEFAULTS[table]) {
      row = { ...FIN_DEFAULTS[table], ...row }
      if (table === 'cost_rates') row.valid_from = row.valid_from ?? now.slice(0, 10)
      if (table !== 'cost_rates' && table !== 'fx_rates' && !this.db.projects.some((p) => p.id === row.project_id)) return { error: { status: 409, code: '23503', message: 'Proje bulunamadı' } }
      const g = this.financeGuard(table, row, null)
      if (g) return g
    }
    if (!system && ['notifications', 'project_events', 'radar_actions', 'radar_opportunities', 'radar_items', 'radar_evidence', 'radar_opportunity_categories', 'radar_source_runs'].includes(table)) return { error: { status: 403, code: '42501', message: 'permission denied' } }
    this.db[table].push(row)
    this.broadcast(table, 'INSERT', row, null)
    this.afterInsert(table, row, actor)
    if (table === 'quantity_items') this.insertRow('quantity_item_history', { item_id: row.id, takeoff_id: row.takeoff_id, project_id: row.project_id, poz_code: row.poz_code, action: 'ekle', changes: {} }, actor)
    if (table === 'projects') this.insertRow('project_status_history', { project_id: row.id, from_status: null, to_status: row.status }, actor)
    if (table === 'quotes') {
      const copy = this.copyNote
      this.insertRow('quote_history', {
        quote_id: row.id, root_id: row.root_id, action: row.revision > 1 ? 'revizyon' : copy ? 'kopya' : 'olustur', from_status: null, to_status: row.status,
        note: row.revision > 1 ? `Rev ${row.revision}` : copy ? `${copy} kopyası` : null,
      }, actor)
    }
    return { row }
  }

  updateRow(table, id, patch, actor = OWNER.id, system = false) {
    const i = this.db[table].findIndex((r) => r.id === id)
    if (i === -1) return null
    const old = this.db[table][i]
    if (table === 'quantity_items') {
      const t = this.db.quantity_takeoffs.find((x) => x.id === old.takeoff_id)
      if (t && t.status !== 'taslak') return guardError('Onaylanmış veya arşivlenmiş metraj sürümü değiştirilemez; yeni sürüm oluşturun')
    }
    if (table === 'quotes' && !system) {
      const changed = (keys) => Object.keys(patch).filter((k) => !keys.includes(k) && JSON.stringify(patch[k]) !== JSON.stringify(old[k]))
      if (['root_id', 'quote_no', 'revision'].some((k) => k in patch && patch[k] !== old[k])) return guardError('Teklif numarası ve revizyonu değiştirilemez')
      if (old.superseded && changed(['project_id', 'internal_notes']).length) return guardError('Eski teklif revizyonu değiştirilemez; güncel revizyonu kullanın')
      if (!old.superseded && patch.superseded === false && old.superseded !== false) return guardError('Teklif revizyon kilidi kaldırılamaz')
      if (old.status !== 'taslak') {
        if (patch.status === 'taslak') return guardError('Gönderilmiş teklif taslağa döndürülemez; değişiklik için revizyon oluşturun')
        if (changed(QUOTE_FREE).length) return guardError('Gönderilmiş teklifin içeriği değiştirilemez; revizyon oluşturun')
      }
      if (patch.status && patch.status !== old.status) {
        patch = { ...patch }
        if (patch.status !== 'taslak' && !old.sent_at) patch.sent_at = this.now()
        if (['kabul', 'red'].includes(patch.status)) patch.decided_at = this.now()
        else if (['kabul', 'red'].includes(old.status)) patch.decided_at = null
      }
    }
    if (table === 'quote_items' && !system) {
      const q = this.db.quotes.find((x) => x.id === old.quote_id)
      if (q && (q.superseded || q.status !== 'taslak')) return guardError('Gönderilmiş veya eski revizyon teklifin kalemleri değiştirilemez; revizyon oluşturun')
    }
    if (table === 'quantity_takeoffs') {
      if (old.status === 'onaylandi' && patch.status && !['onaylandi', 'arsiv'].includes(patch.status)) return guardError('Onaylanmış metraj sürümü değiştirilemez; yeni sürüm oluşturun')
      if (old.status === 'arsiv' && patch.status && patch.status !== 'arsiv') return guardError('Arşivlenmiş sürüm yeniden açılamaz; yeni sürüm oluşturun')
      if (patch.status === 'onaylandi' && old.status === 'taslak') patch = { ...patch, approved_at: this.now(), approved_by: actor }
    }
    if (table === 'notifications' && Object.keys(patch).some((k) => k !== 'read_at')) return { error: { status: 403, code: '42501', message: 'permission denied for table notifications' } }
    let next = { ...old, ...patch, id: old.id, created_at: old.created_at, created_by: old.created_by, updated_at: this.now(), version: (old.version ?? 0) + 1 }
    if (table === 'quantity_items') {
      next.original = old.original ?? null
      if (next.verification === 'onaylandi') {
        next.approved_by = old.verification === 'onaylandi' ? old.approved_by : actor
        next.approved_at = old.verification === 'onaylandi' ? old.approved_at : this.now()
        next.uncertain = false
      } else {
        next.approved_by = null
        next.approved_at = null
      }
    }
    if (FIN_DEFAULTS[table] && !system) {
      const g = this.financeGuard(table, next, old)
      if (g) return g
    }
    if (table === 'projects') {
      if (next.progress > 100 || next.progress < 0) return guardError('projects_progress_check')
      next = this.syncStage(next, old)
    }
    if (table === 'project_tasks') next.done_at = next.done ? (old.done ? old.done_at : this.now()) : null
    if (RADAR_UPDATABLE[table] && !system) {
      // Sütun düzeyi yetki (015 GRANT UPDATE (...) ile aynı)
      const bad = Object.keys(patch).filter((k) => !RADAR_UPDATABLE[table].includes(k))
      if (bad.length) return { error: { status: 403, code: '42501', message: `permission denied for column ${bad[0]}` } }
    }
    this.db[table][i] = next
    this.broadcast(table, 'UPDATE', next, { id: old.id })
    this.afterUpdate(table, old, next, actor)
    if (table === 'quantity_items') {
      const changes = {}
      for (const k of Object.keys(patch)) if (JSON.stringify(old[k]) !== JSON.stringify(next[k])) changes[k] = { eski: old[k] ?? null, yeni: next[k] ?? null }
      if (Object.keys(changes).length) this.insertRow('quantity_item_history', { item_id: next.id, takeoff_id: next.takeoff_id, project_id: next.project_id, poz_code: next.poz_code, action: 'guncelle', changes }, actor)
    }
    if (table === 'projects' && next.status !== old.status) {
      this.insertRow('project_status_history', { project_id: id, from_status: old.status, to_status: next.status }, actor)
    }
    if (table === 'radar_opportunities' && next.status !== old.status) {
      this.insertRow('radar_actions', { opportunity_id: id, from_status: old.status, to_status: next.status, note: next.status_note ?? null }, actor, true)
    }
    if (table === 'quotes' && patch.status && patch.status !== old.status) {
      this.insertRow('quote_history', { quote_id: id, root_id: old.root_id, action: 'durum', from_status: old.status, to_status: patch.status, note: null }, actor)
    }
    return next
  }

  deleteRow(table, id, cascade = false) {
    const i = this.db[table].findIndex((r) => r.id === id)
    if (i === -1) return null
    if (!cascade && table === 'quantity_items') {
      const t = this.db.quantity_takeoffs.find((x) => x.id === this.db[table][i].takeoff_id)
      if (t && t.status !== 'taslak') return guardError('Onaylanmış veya arşivlenmiş metraj sürümündeki poz silinemez')
    }
    if (!cascade && table === 'quantity_takeoffs' && this.db[table][i].status === 'onaylandi') return guardError('Onaylanmış metraj sürümü silinemez; arşivleyebilirsiniz')
    if (!cascade && table === 'quotes') {
      const q = this.db[table][i]
      if (q.superseded) return guardError('Eski teklif revizyonu silinemez; geçmiş olarak saklanır')
      if (q.status !== 'taslak') return guardError('Gönderilmiş teklif silinemez; durumunu "Reddedildi" yapabilirsiniz')
    }
    if (!cascade && table === 'quote_items') {
      const q = this.db.quotes.find((x) => x.id === this.db[table][i].quote_id)
      if (q && (q.superseded || q.status !== 'taslak')) return guardError('Gönderilmiş veya eski revizyon teklifin kalemleri değiştirilemez; revizyon oluşturun')
    }
    if (table === 'companies' && this.db.quotes.some((q) => q.company_id === id)) {
      return { error: { status: 409, code: '23503', message: 'update or delete on table "companies" violates foreign key constraint "quotes_company_id_fkey"' } }
    }
    if (table === 'companies' && this.db.projects.some((p) => p.company_id === id)) {
      return { error: { status: 409, code: '23503', message: 'update or delete on table "companies" violates foreign key constraint' } }
    }
    const [row] = this.db[table].splice(i, 1)
    this.broadcast(table, 'DELETE', null, { id: row.id })
    // ON DELETE CASCADE karşılıkları
    if (table === 'companies') for (const c of this.db.contacts.filter((x) => x.company_id === id)) this.deleteRow('contacts', c.id)
    if (table === 'projects') {
      for (const t of ['project_notes', 'project_files', 'project_status_history', 'project_collections', 'project_payment_schedule', 'project_expenses', 'project_cost_lines', 'project_budgets', 'fx_rates', 'quantity_items', 'quantity_takeoffs', 'cad_analyses', 'quantity_item_history', 'project_tasks', 'project_events']) {
        for (const r of this.db[t].filter((x) => x.project_id === id)) this.deleteRow(t, r.id, true)
      }
    }
    if (table === 'quantity_takeoffs') for (const r of this.db.quantity_items.filter((x) => x.takeoff_id === id)) this.deleteRow('quantity_items', r.id, true)
    if (table === 'projects') for (const q of this.db.quotes.filter((x) => x.project_id === id)) this.updateRow('quotes', q.id, { project_id: null }, OWNER.id, true)
    if (table === 'quantity_items') for (const qi of this.db.quote_items.filter((x) => x.source_item_id === id)) this.updateRow('quote_items', qi.id, { source_item_id: null }, OWNER.id, true)
    if (table === 'quantity_takeoffs') for (const qi of this.db.quote_items.filter((x) => x.source_takeoff_id === id)) this.updateRow('quote_items', qi.id, { source_takeoff_id: null }, OWNER.id, true)
    if (table === 'quotes') {
      for (const r of this.db.quote_items.filter((x) => x.quote_id === id)) this.deleteRow('quote_items', r.id, true)
      for (const r of this.db.quote_history.filter((x) => x.quote_id === id)) this.deleteRow('quote_history', r.id, true)
      if (row.revision > 1) {
        const prev = this.db.quotes.filter((q) => q.root_id === row.root_id).sort((a, b) => b.revision - a.revision)[0]
        if (prev?.superseded) this.updateRow('quotes', prev.id, { superseded: false }, OWNER.id, true)
      }
    }
    if (table === 'project_payment_schedule') for (const c of this.db.project_collections.filter((x) => x.schedule_id === id)) this.updateRow('project_collections', c.id, { schedule_id: null }, OWNER.id, true)
    if (table === 'cost_rates') for (const l of this.db.project_cost_lines.filter((x) => x.cost_rate_id === id)) this.updateRow('project_cost_lines', l.id, { cost_rate_id: null }, OWNER.id, true)
    if (table === 'quotes') for (const b of this.db.project_budgets.filter((x) => x.source_quote_id === id)) this.updateRow('project_budgets', b.id, { source_quote_id: null }, OWNER.id, true)
    if (table === 'project_files') for (const a of this.db.cad_analyses.filter((x) => x.file_id === id)) this.updateRow('cad_analyses', a.id, { file_id: null })
    if (table === 'cad_analyses') for (const t of this.db.quantity_takeoffs.filter((x) => x.analysis_id === id)) this.updateRow('quantity_takeoffs', t.id, { analysis_id: null })
    if (table === 'quantity_items' && !cascade) this.insertRow('quantity_item_history', { item_id: row.id, takeoff_id: row.takeoff_id, project_id: row.project_id, poz_code: row.poz_code, action: 'sil', changes: {} })
    return { row }
  }

  // ---------------------------------------------------------------- "başka cihaz" simülasyonu
  externalInsert(table, input) {
    return this.insertRow(table, input).row
  }
  /** Sunucu (radar_ingest) yazımının karşılığı: istemcinin yazamadığı radar tablolarına test verisi */
  serverInsert(table, input) {
    const r = this.insertRow(table, input, null, true)
    if (r.error) throw new Error(r.error.message)
    return r.row
  }
  externalUpdate(table, id, patch) {
    return this.updateRow(table, id, patch)
  }
  externalDelete(table, id) {
    return this.deleteRow(table, id)
  }
  /** Tüm Realtime bağlantılarını koparır (ağ kesintisi) */
  dropSockets() {
    for (const s of [...this.sockets]) s.ws.close({ code: 1006, reason: 'test: bağlantı koptu' })
    this.sockets.clear()
  }
  get activeChannelCount() {
    let n = 0
    for (const s of this.sockets) n += s.channels.size
    return n
  }

  // ---------------------------------------------------------------- Realtime
  broadcast(table, type, record, oldRecord) {
    for (const s of this.sockets) {
      if (!this.isOwner(s.user)) continue // RLS: yalnızca sahip olay alır
      for (const ch of s.channels.values()) {
        const binding = ch.bindings.find((b) => b.table === table)
        if (!binding) continue
        s.send([ch.joinRef, null, ch.topic, 'postgres_changes', {
          ids: [binding.id],
          data: { schema: 'public', table, commit_timestamp: this.now(), type, columns: [], record: record ?? undefined, old_record: oldRecord ?? undefined, errors: null },
        }])
      }
    }
  }

  async attach(page) {
    await page.route(`${SUPABASE_URL}/**`, (route) => this.handle(route))
    await page.routeWebSocket(/\/realtime\/v1\/websocket/, (ws) => {
      const state = { ws, user: null, channels: new Map(), send: (msg) => ws.send(JSON.stringify(msg)) }
      const url = new URL(ws.url())
      const key = url.searchParams.get('apikey')
      this.sockets.add(state)
      ws.onClose(() => this.sockets.delete(state))
      ws.onMessage((raw) => {
        const [joinRef, ref, topic, event, payload] = JSON.parse(String(raw))
        if (topic === 'phoenix' && event === 'heartbeat') return state.send([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }])
        if (event === 'phx_join') {
          const token = payload?.access_token
          state.user = token ? this.userFromAuth({ authorization: `Bearer ${token}` }) : null
          const bindings = (payload?.config?.postgres_changes ?? []).map((f) => ({ ...f, id: this.channelSeq++ }))
          state.channels.set(topic, { topic, joinRef, bindings })
          this.requests.push({ kind: 'realtime_join', topic, key, user: state.user?.email ?? null })
          return state.send([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: { postgres_changes: bindings } }])
        }
        if (event === 'phx_leave') {
          state.channels.delete(topic)
          this.requests.push({ kind: 'realtime_leave', topic })
          return state.send([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: {} }])
        }
        if (event === 'access_token') {
          state.user = this.userFromAuth({ authorization: `Bearer ${payload?.access_token}` })
        }
      })
    })
  }

  // ---------------------------------------------------------------- HTTP
  async handle(route) {
    const req = route.request()
    const url = new URL(req.url())
    const p = url.pathname
    const headers = req.headers()
    const user = this.userFromAuth(headers)
    this.requests.push({ kind: 'http', method: req.method(), path: p + url.search, user: user?.email ?? null })

    const json = (status, body, extra = {}) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body), headers: { 'access-control-allow-origin': '*', ...extra } })

    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } })

    if (this.failNext && p.includes(this.failNext.match) && (!this.failNext.method || this.failNext.method === req.method())) {
      const f = this.failNext
      this.failNext = null
      // Sunucu isteği işler ama yanıt istemciye ulaşmaz (mobil bağlantı kopması)
      if (f.loseResponse) {
        await this.handle({ request: () => req, fulfill: async () => {}, abort: async () => {} })
        return route.abort('failed')
      }
      if (f.abort) return route.abort('failed')
      return json(f.status, f.body)
    }

    // ---------------- Auth
    if (p === '/auth/v1/token') {
      const body = req.postDataJSON()
      const u = [OWNER, INTRUDER].find((x) => x.email === body.email && x.password === body.password)
      if (!u) return json(400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' })
      const now = Math.floor(Date.now() / 1000)
      return json(200, {
        access_token: fakeJwt(u),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: now + 3600,
        refresh_token: randomUUID(),
        user: { id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, last_sign_in_at: new Date().toISOString(), app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' },
      })
    }
    if (p === '/auth/v1/logout') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } })
    if (p === '/auth/v1/user') return user ? json(200, { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated' }) : json(401, { msg: 'invalid JWT' })

    // ---------------- RPC
    if (p === '/rest/v1/rpc/is_owner') return user ? json(200, this.isOwner(user)) : json(401, { code: '42501', message: 'permission denied' })
    if (p === '/rest/v1/rpc/suggest_project_code') {
      if (!this.isOwner(user)) return json(200, 'LX-2026-001')
      const year = new Date().getFullYear()
      const nums = this.db.projects.map((x) => x.code.match(new RegExp(`^LX-${year}-(\\d+)$`))?.[1]).filter(Boolean).map(Number)
      return json(200, `LX-${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`)
    }
    if (p === '/rest/v1/rpc/next_takeoff_revision') {
      if (!user) return json(401, { code: '42501', message: 'permission denied' })
      const { p_project } = req.postDataJSON()
      const revs = this.isOwner(user) ? this.db.quantity_takeoffs.filter((t) => t.project_id === p_project).map((t) => t.revision) : []
      return json(200, (revs.length ? Math.max(...revs) : 0) + 1)
    }
    if (p === '/rest/v1/rpc/create_takeoff_revision') {
      if (!this.isOwner(user)) return json(400, { code: 'P0002', message: 'Kaynak metraj sürümü bulunamadı' })
      const { p_source, p_name } = req.postDataJSON()
      const src = this.db.quantity_takeoffs.find((t) => t.id === p_source)
      if (!src) return json(400, { code: 'P0002', message: 'Kaynak metraj sürümü bulunamadı' })
      const revision = Math.max(...this.db.quantity_takeoffs.filter((t) => t.project_id === src.project_id).map((t) => t.revision)) + 1
      const { row } = this.insertRow('quantity_takeoffs', { project_id: src.project_id, name: p_name || 'Metraj', revision, based_on: src.id, analysis_id: src.analysis_id })
      for (const it of this.db.quantity_items.filter((x) => x.takeoff_id === src.id)) {
        const { id: _i, created_at: _c, updated_at: _u, version: _v, created_by: _b, ...rest } = it
        this.insertRow('quantity_items', { ...rest, takeoff_id: row.id })
      }
      return json(200, row.id)
    }

    if (p === '/rest/v1/rpc/check_reminders') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      return json(200, this.runReminders())
    }
    if (p === '/rest/v1/rpc/notify_client_event') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      const b = req.postDataJSON()
      if (!['surum_yeni', 'cad_hata', 'push_test', 'cad_basladi'].includes(b.p_kind)) return json(400, { code: '22023', message: 'Geçersiz olay türü' })
      const cadKind = b.p_kind === 'cad_hata' || b.p_kind === 'cad_basladi'
      this.notify(cadKind ? 'cad' : 'sistem', b.p_kind, b.p_title, b.p_body, b.p_link, null, null, `${b.p_kind}:${b.p_key}`, user.id, !cadKind)
      return json(200, null)
    }
    if (p === '/rest/v1/rpc/push_public_key') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      return json(200, this.vapidPublic)
    }
    if (p === '/rest/v1/rpc/register_push_subscription') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      const b = req.postDataJSON()
      const ex = this.db.push_subscriptions.find((x) => x.endpoint === b.p_endpoint)
      if (ex) this.updateRow('push_subscriptions', ex.id, { p256dh: b.p_p256dh, auth_key: b.p_auth, last_seen_at: this.now(), disabled_at: null, failure_count: 0 })
      else this.insertRow('push_subscriptions', { user_id: user.id, endpoint: b.p_endpoint, p256dh: b.p_p256dh, auth_key: b.p_auth, user_agent: b.p_user_agent, device_label: b.p_label, last_seen_at: this.now(), last_success_at: null, failure_count: 0, disabled_at: null })
      return json(200, (ex ?? this.db.push_subscriptions.at(-1)).id)
    }

    if (p === '/rest/v1/rpc/copy_quote') {
      if (!user) return json(401, { code: '42501', message: 'permission denied' })
      const { p_source, p_mode } = req.postDataJSON()
      const src = this.isOwner(user) ? this.db.quotes.find((q) => q.id === p_source) : null
      if (!src) return json(400, { code: 'P0002', message: 'Kaynak teklif bulunamadı' })
      if (p_mode === 'revizyon' && src.superseded) return json(400, { code: '23514', message: 'Eski revizyondan yeni revizyon oluşturulamaz; güncel revizyonu kullanın' })
      const { id: _i, created_at: _c, updated_at: _u, version: _v, created_by: _b, quote_no: _n, root_id, revision: _r, status: _s, superseded: _x, sent_at: _sa, decided_at: _d, ...content } = src
      const today = this.now().slice(0, 10)
      const days = src.valid_until ? Math.round((Date.parse(src.valid_until) - Date.parse(src.quote_date)) / 86400000) : null
      const validUntil = days == null ? null : new Date(Date.parse(today) + days * 86400000).toISOString().slice(0, 10)
      const revision = p_mode === 'revizyon' ? Math.max(...this.db.quotes.filter((q) => q.root_id === root_id).map((q) => q.revision)) + 1 : 1
      this.copyNote = p_mode === 'kopya' ? `${src.quote_no} Rev ${src.revision}` : null
      const r = this.insertRow('quotes', { ...content, root_id: p_mode === 'revizyon' ? root_id : undefined, revision, title: p_mode === 'kopya' ? `${src.title} (kopya)`.slice(0, 200) : src.title, quote_date: today, valid_until: validUntil }, user.id)
      this.copyNote = null
      if (r.error) return json(r.error.status, { code: r.error.code, message: r.error.message })
      for (const it of this.db.quote_items.filter((x) => x.quote_id === src.id)) {
        const { id: _ii, created_at: _ci, updated_at: _ui, version: _vi, created_by: _bi, ...rest } = it
        this.insertRow('quote_items', { ...rest, quote_id: r.row.id }, user.id, true)
      }
      if (p_mode === 'revizyon') this.updateRow('quotes', src.id, { superseded: true }, user.id, true)
      return json(200, r.row.id)
    }


    // ---------------- 015: LEONX AI Radar
    if (p === '/rest/v1/rpc/radar_claim_source_test') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      const { p_source } = req.postDataJSON()
      const src = this.db.radar_sources.find((x) => x.id === p_source)
      if (!src || (src.last_test_at && Date.now() - Date.parse(src.last_test_at) < 5 * 60000)) return json(200, false)
      this.updateRow('radar_sources', src.id, { last_test_at: this.now() }, user.id, true)
      return json(200, true)
    }
    if (p === '/rest/v1/rpc/radar_add_manual_item') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      const { p_url, p_title, p_text } = req.postDataJSON()
      if (!/^https?:\/\/[^\s/?#]+\.[^\s/?#]+/i.test(p_url ?? '')) return json(400, { code: '23514', message: 'Geçerli bir http(s) adresi girin' })
      const clean = (t) => String(t ?? '').replace(/<(script|style)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
      const canon = p_url.replace(/#.*$/, '')
      const ex = this.db.radar_items.find((x) => x.canonical_url === canon)
      if (ex) return json(200, ex.id)
      let src = this.db.radar_sources.find((x) => x.kind === 'manual' && !x.url)
      if (!src) src = this.insertRow('radar_sources', { name: 'Elle eklenen bağlantılar', kind: 'manual', permission_status: 'inceleniyor', active: false }, user.id, true).row
      const text = clean(p_text)
      const row = this.insertRow('radar_items', { source_id: src.id, canonical_url: canon, url_hash: canon, title: clean(p_title) || text.slice(0, 200), summary: text.slice(0, 4000), raw_text: text, content_hash: 'x', pending: true, first_seen_at: this.now(), last_seen_at: this.now() }, user.id, true).row
      return json(200, row.id)
    }
    // 016: sağlık özeti ve fırsattan görev (supabase/migrations/20261023001600_leonx_radar_intel.sql ile aynı kurallar)
    if (p === '/rest/v1/rpc/radar_health') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      const day = Date.now() - 86400000
      const runs = this.db.radar_source_runs.filter((r) => Date.parse(r.started_at) > day)
      return json(200, {
        checked_at: this.now(), scan_configured: !!this.radarScanConfigured,
        active_sources: this.db.radar_sources.filter((s) => s.active && s.permission_status === 'izinli').length,
        failing_sources: this.db.radar_sources.filter((s) => s.active && s.consecutive_failures >= 3).map((s) => ({ id: s.id, name: s.name, failures: s.consecutive_failures, last_status: s.last_status })),
        last_run_at: this.db.radar_source_runs.map((r) => r.started_at).sort().at(-1) ?? null,
        runs_24h: runs.length, errors_24h: runs.filter((r) => r.status === 'hata').length,
        pending_notifications: this.db.radar_opportunities.filter((o) => !o.notified_at).length,
      })
    }
    if (p === '/rest/v1/rpc/radar_create_task') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      const { p_opportunity, p_title, p_due } = req.postDataJSON()
      const title = String(p_title ?? '').trim()
      if (title.length < 1 || title.length > 200) return json(400, { code: '22023', message: 'Görev başlığı 1–200 karakter olmalı' })
      const opp = this.db.radar_opportunities.find((x) => x.id === p_opportunity)
      if (!opp) return json(400, { code: 'P0002', message: 'Fırsat bulunamadı' })
      let projectId = opp.project_id && this.db.projects.some((x) => x.id === opp.project_id) ? opp.project_id : null
      if (!projectId) {
        const year = new Date().getFullYear()
        const nums = this.db.projects.map((x) => x.code.match(new RegExp(`^LX-${year}-(\\d+)$`))?.[1]).filter(Boolean).map(Number)
        const code = `LX-${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`
        projectId = this.insertRow('projects', { code, name: opp.title.slice(0, 200), category: 'diger', company_id: opp.crm_company_id, stage: 'yeni_firsat', location: [opp.district, opp.city].filter(Boolean).join(' / ') || null, description: 'LEONX Radar proje adayı' }, user.id).row.id
        this.updateRow('radar_opportunities', opp.id, { project_id: projectId }, user.id, true)
      }
      const today = new Date().toISOString().slice(0, 10)
      const soon = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
      const priority = opp.deadline && opp.deadline <= soon ? 'acil' : opp.verified_need ? 'yuksek' : 'normal'
      const due = p_due ?? (opp.deadline && opp.deadline >= today ? opp.deadline : null)
      const task = this.insertRow('project_tasks', { project_id: projectId, title, description: `LEONX Radar fırsatı: ${opp.title}`, priority, due_date: due }, user.id).row
      return json(200, { project_id: projectId, task_id: task.id })
    }
    if (p === '/rest/v1/rpc/radar_import_to_crm') {
      if (!this.isOwner(user)) return json(403, { code: '42501', message: 'Yetkisiz' })
      const { p_opportunity, p_company, p_create_project } = req.postDataJSON()
      const opp = this.db.radar_opportunities.find((x) => x.id === p_opportunity)
      if (!opp) return json(400, { code: 'P0002', message: 'Fırsat bulunamadı' })
      let companyId = null
      let projectId = null
      if (p_company) {
        const rc = this.db.radar_companies.find((x) => x.id === p_company)
        if (!rc || !this.db.radar_opportunity_companies.some((l) => l.opportunity_id === opp.id && l.company_id === rc.id)) return json(400, { code: 'P0002', message: 'Firma bu fırsatla ilişkili değil' })
        if (rc.crm_company_id && this.db.companies.some((c) => c.id === rc.crm_company_id)) companyId = rc.crm_company_id
        else {
          const email = this.db.radar_contacts.find((k) => k.company_id === rc.id && k.kind.endsWith('eposta'))?.value ?? null
          const phone = this.db.radar_contacts.find((k) => k.company_id === rc.id && k.kind === 'telefon')?.value ?? null
          companyId = this.insertRow('companies', { name: rc.name, email, phone, notes: 'LEONX Radar fırsatından aktarıldı.' }, user.id).row.id
          this.updateRow('radar_companies', rc.id, { crm_company_id: companyId }, user.id, true)
        }
        if (!opp.crm_company_id) this.updateRow('radar_opportunities', opp.id, { crm_company_id: companyId }, user.id, true)
      }
      if (p_create_project) {
        const cur = this.db.radar_opportunities.find((x) => x.id === opp.id)
        if (cur.project_id && this.db.projects.some((x) => x.id === cur.project_id)) projectId = cur.project_id
        else {
          const year = new Date().getFullYear()
          const nums = this.db.projects.map((x) => x.code.match(new RegExp(`^LX-${year}-(\\d+)$`))?.[1]).filter(Boolean).map(Number)
          const code = `LX-${year}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, '0')}`
          projectId = this.insertRow('projects', { code, name: cur.title.slice(0, 200), category: 'diger', company_id: companyId ?? cur.crm_company_id, stage: 'yeni_firsat', location: [cur.district, cur.city].filter(Boolean).join(' / ') || null, description: 'LEONX Radar proje adayı' }, user.id).row.id
          this.updateRow('radar_opportunities', opp.id, { project_id: projectId }, user.id, true)
        }
      }
      return json(200, { company_id: companyId, project_id: projectId })
    }

    // ---------------- Edge Functions (radar)
    if (p.startsWith('/functions/v1/')) {
      const fn = p.slice('/functions/v1/'.length)
      this.functionCalls.push({ fn, user: user?.email ?? null, body: req.method() === 'POST' ? req.postDataJSON() : null })
      if (!this.radarFunctionsDeployed) return json(404, { code: 'NOT_FOUND', message: 'Requested function was not found' })
      if (!this.isOwner(user)) return json(403, { error: 'Yetkisiz' })
      const b = req.postDataJSON() ?? {}
      if (fn === 'radar-scan' && b.test_source_id) {
        // SENTETİK test yanıtı (gerçek kaynak indirilmedi)
        return json(200, { ok: true, error: null, http_status: 200, content_type: 'application/rss+xml', item_count: 2, items: [{ title: 'Sentetik ilan 1', link: 'https://akis.ornek.test/1' }, { title: 'Sentetik ilan 2', link: 'https://akis.ornek.test/2' }], warnings: ['Tarih okunamadı: "dün"'], robots: 'gerekmiyor' })
      }
      if (fn === 'radar-contacts') {
        const rc = this.db.radar_companies.find((x) => x.id === b.company_id)
        if (!rc?.website) return json(400, { error: 'Firmanın web sitesi kayıtlı değil.' })
        const host = new URL(rc.website).hostname.replace(/^www\./, '')
        this.insertRow('radar_contacts', { company_id: rc.id, kind: 'satinalma_eposta', value: `satinalma@${host}`, source_url: `${rc.website.replace(/\/$/, '')}/iletisim`, verified_at: this.now() }, user.id, true)
        return json(200, { pages: [{ url: `${rc.website}/iletisim`, status: 200, note: null }], saved: 1, skipped_personal: 1, skipped_foreign_domain: 0, skipped_irrelevant: 0 })
      }
      return json(404, { message: 'mock: bilinmeyen işlev' })
    }

    // ---------------- Storage
    if (p.startsWith('/storage/v1/object')) {
      if (!this.isOwner(user)) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' })
      const rest = p.replace(/^\/storage\/v1\/object\/(authenticated\/)?/, '')
      if (req.method() === 'POST' && rest.startsWith('project-files/')) {
        const objectPath = rest.slice('project-files/'.length)
        const projectId = objectPath.split('/')[0]
        if (!this.db.projects.some((x) => x.id === projectId)) return json(403, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' })
        this.storage.set(objectPath, req.postDataBuffer() ?? Buffer.from(''))
        return json(200, { Key: `project-files/${objectPath}`, Id: randomUUID() })
      }
      if (req.method() === 'GET' && rest.startsWith('project-files/')) {
        const objectPath = rest.slice('project-files/'.length)
        if (!this.storage.has(objectPath)) return json(404, { statusCode: '404', error: 'not_found', message: 'Object not found' })
        return route.fulfill({ status: 200, contentType: 'application/octet-stream', body: 'LEONX test dosyası', headers: { 'access-control-allow-origin': '*' } })
      }
      if (req.method() === 'DELETE' && rest === 'project-files') {
        const { prefixes } = req.postDataJSON()
        for (const x of prefixes) this.storage.delete(x)
        return json(200, prefixes.map((name) => ({ name, bucket_id: 'project-files' })))
      }
      return json(400, { message: 'mock: desteklenmeyen depolama isteği' })
    }

    // ---------------- PostgREST
    const m = p.match(/^\/rest\/v1\/([a-z_]+)$/)
    if (m && TABLES.includes(m[1])) return this.handleTable(route, req, url, m[1], user, json)

    return json(404, { message: `mock: bilinmeyen uç nokta ${p}` })
  }

  handleTable(route, req, url, table, user, json) {
    const wantsObject = (req.headers()['accept'] || '').includes('vnd.pgrst.object')
    const reply = (rows) => {
      if (wantsObject) {
        if (rows.length !== 1) return json(406, { code: 'PGRST116', details: `The result contains ${rows.length} rows`, hint: null, message: 'JSON object requested, multiple (or no) rows returned' })
        return json(200, rows[0])
      }
      return json(200, rows)
    }
    const filters = []
    for (const [k, v] of url.searchParams) {
      if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict', 'or'].includes(k)) continue
      if (v === 'is.null') filters.push((r) => r[k] == null)
      const fm = v.match(/^eq\.(.*)$/)
      if (fm) filters.push((r) => String(r[k]) === fm[1])
      const im = v.match(/^in\.\((.*)\)$/)
      if (im) {
        const set = new Set(im[1].split(',').map((x) => x.replace(/^"|"$/g, '')))
        filters.push((r) => set.has(String(r[k])))
      }
    }
    const match = (r) => filters.every((f) => f(r))
    const owner = this.isOwner(user)
    const method = req.method()

    if (method === 'GET') {
      if (!user) return json(401, { code: '42501', message: 'permission denied' })
      let rows = owner ? this.db[table].filter(match) : [] // RLS: sahip değilse satır yok
      const order = url.searchParams.get('order')
      if (order) {
        const keys = order.split(',').map((o) => o.split('.'))
        rows = [...rows].sort((a, b) => {
          for (const [k, dir] of keys) {
            const av = a[k] ?? ''
            const bv = b[k] ?? ''
            const c = typeof av === 'boolean' ? Number(av) - Number(bv) : String(av).localeCompare(String(bv), 'tr')
            if (c) return dir === 'desc' ? -c : c
          }
          return 0
        })
      }
      // .range(from, to) → offset/limit; gerçek PostgREST gibi yanıt max-rows (1000) ile kesilir
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 1000), 1000)
      return reply(rows.slice(offset, offset + limit))
    }
    if (!owner) return json(403, { code: '42501', message: 'new row violates row-level security policy' })

    if (method === 'POST') {
      const body = req.postDataJSON()
      const inputs = Array.isArray(body) ? body : [body]
      const out = []
      for (const input of inputs) {
        const r = this.insertRow(table, input)
        if (r.error) return json(r.error.status, { code: r.error.code, message: r.error.message, details: null, hint: null })
        out.push(r.row)
      }
      return reply(out)
    }
    if (method === 'PATCH') {
      const patch = req.postDataJSON()
      const targets = this.db[table].filter(match)
      const out = []
      for (const t of targets) {
        const r = this.updateRow(table, t.id, patch)
        if (r?.error) return json(r.error.status, { code: r.error.code, message: r.error.message, details: null, hint: null })
        out.push(r)
      }
      return reply(out)
    }
    if (method === 'DELETE') {
      const targets = this.db[table].filter(match)
      const out = []
      for (const t of targets) {
        const r = this.deleteRow(table, t.id)
        if (r?.error) return json(r.error.status, { code: r.error.code, message: r.error.message, details: null, hint: null })
        out.push({ id: t.id })
      }
      return reply(out)
    }
    return json(405, { message: 'mock: desteklenmeyen yöntem' })
  }
}
