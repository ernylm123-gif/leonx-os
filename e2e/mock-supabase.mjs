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
]
const guardError = (message) => ({ error: { status: 400, code: '23514', message } })

export class MockSupabase {
  constructor() {
    this.db = Object.fromEntries(TABLES.map((t) => [t, []]))
    this.storage = new Map()
    this.sockets = new Set()
    this.channelSeq = 1
    this.historySeq = 1
    this.requests = []
    this.failNext = null
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
  insertRow(table, input, actor = OWNER.id) {
    const now = this.now()
    let row
    if (table === 'project_status_history' || table === 'quantity_item_history') {
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
    }
    if (table === 'projects') {
      row = { status: 'kesif', priority: 'normal', company_id: null, description: null, start_date: null, due_date: null, location: null, notes: null, ...row }
      if (this.db.projects.some((p) => p.code === row.code)) return { error: { status: 409, code: '23505', message: 'duplicate key value violates unique constraint "projects_code_key"' } }
    }
    this.db[table].push(row)
    this.broadcast(table, 'INSERT', row, null)
    if (table === 'quantity_items') this.insertRow('quantity_item_history', { item_id: row.id, takeoff_id: row.takeoff_id, project_id: row.project_id, poz_code: row.poz_code, action: 'ekle', changes: {} }, actor)
    if (table === 'projects') this.insertRow('project_status_history', { project_id: row.id, from_status: null, to_status: row.status }, actor)
    return { row }
  }

  updateRow(table, id, patch, actor = OWNER.id) {
    const i = this.db[table].findIndex((r) => r.id === id)
    if (i === -1) return null
    const old = this.db[table][i]
    if (table === 'quantity_items') {
      const t = this.db.quantity_takeoffs.find((x) => x.id === old.takeoff_id)
      if (t && t.status !== 'taslak') return guardError('Onaylanmış veya arşivlenmiş metraj sürümü değiştirilemez; yeni sürüm oluşturun')
    }
    if (table === 'quantity_takeoffs') {
      if (old.status === 'onaylandi' && patch.status && !['onaylandi', 'arsiv'].includes(patch.status)) return guardError('Onaylanmış metraj sürümü değiştirilemez; yeni sürüm oluşturun')
      if (old.status === 'arsiv' && patch.status && patch.status !== 'arsiv') return guardError('Arşivlenmiş sürüm yeniden açılamaz; yeni sürüm oluşturun')
      if (patch.status === 'onaylandi' && old.status === 'taslak') patch = { ...patch, approved_at: this.now(), approved_by: actor }
    }
    const next = { ...old, ...patch, id: old.id, created_at: old.created_at, created_by: old.created_by, updated_at: this.now(), version: old.version + 1 }
    this.db[table][i] = next
    this.broadcast(table, 'UPDATE', next, { id: old.id })
    if (table === 'quantity_items') {
      const changes = {}
      for (const k of Object.keys(patch)) if (JSON.stringify(old[k]) !== JSON.stringify(next[k])) changes[k] = { eski: old[k] ?? null, yeni: next[k] ?? null }
      if (Object.keys(changes).length) this.insertRow('quantity_item_history', { item_id: next.id, takeoff_id: next.takeoff_id, project_id: next.project_id, poz_code: next.poz_code, action: 'guncelle', changes }, actor)
    }
    if (table === 'projects' && patch.status && patch.status !== old.status) {
      this.insertRow('project_status_history', { project_id: id, from_status: old.status, to_status: patch.status }, actor)
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
    if (table === 'companies' && this.db.projects.some((p) => p.company_id === id)) {
      return { error: { status: 409, code: '23503', message: 'update or delete on table "companies" violates foreign key constraint' } }
    }
    const [row] = this.db[table].splice(i, 1)
    this.broadcast(table, 'DELETE', null, { id: row.id })
    // ON DELETE CASCADE karşılıkları
    if (table === 'companies') for (const c of this.db.contacts.filter((x) => x.company_id === id)) this.deleteRow('contacts', c.id)
    if (table === 'projects') {
      for (const t of ['project_notes', 'project_files', 'project_status_history', 'quantity_items', 'quantity_takeoffs', 'cad_analyses', 'quantity_item_history']) {
        for (const r of this.db[t].filter((x) => x.project_id === id)) this.deleteRow(t, r.id, true)
      }
    }
    if (table === 'quantity_takeoffs') for (const r of this.db.quantity_items.filter((x) => x.takeoff_id === id)) this.deleteRow('quantity_items', r.id, true)
    if (table === 'project_files') for (const a of this.db.cad_analyses.filter((x) => x.file_id === id)) this.updateRow('cad_analyses', a.id, { file_id: null })
    if (table === 'cad_analyses') for (const t of this.db.quantity_takeoffs.filter((x) => x.analysis_id === id)) this.updateRow('quantity_takeoffs', t.id, { analysis_id: null })
    if (table === 'quantity_items' && !cascade) this.insertRow('quantity_item_history', { item_id: row.id, takeoff_id: row.takeoff_id, project_id: row.project_id, poz_code: row.poz_code, action: 'sil', changes: {} })
    return { row }
  }

  // ---------------------------------------------------------------- "başka cihaz" simülasyonu
  externalInsert(table, input) {
    return this.insertRow(table, input).row
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
      if (['select', 'order', 'offset', 'limit', 'columns', 'on_conflict'].includes(k)) continue
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
      const limit = Number(url.searchParams.get('limit') ?? 1000)
      return reply(rows.slice(0, limit))
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
