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

const TABLES = ['companies', 'contacts', 'projects', 'project_notes', 'project_files', 'project_status_history']

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
    if (table === 'project_status_history') {
      row = { id: this.historySeq++, changed_at: now, changed_by: actor, ...input }
    } else {
      row = { ...input, id: randomUUID(), created_by: actor, created_at: now, updated_at: now, version: 1 }
    }
    if (table === 'projects') {
      row = { status: 'kesif', priority: 'normal', company_id: null, description: null, start_date: null, due_date: null, location: null, notes: null, ...row }
      if (this.db.projects.some((p) => p.code === row.code)) return { error: { status: 409, code: '23505', message: 'duplicate key value violates unique constraint "projects_code_key"' } }
    }
    this.db[table].push(row)
    this.broadcast(table, 'INSERT', row, null)
    if (table === 'projects') this.insertRow('project_status_history', { project_id: row.id, from_status: null, to_status: row.status }, actor)
    return { row }
  }

  updateRow(table, id, patch, actor = OWNER.id) {
    const i = this.db[table].findIndex((r) => r.id === id)
    if (i === -1) return null
    const old = this.db[table][i]
    const next = { ...old, ...patch, id: old.id, created_at: old.created_at, created_by: old.created_by, updated_at: this.now(), version: old.version + 1 }
    this.db[table][i] = next
    this.broadcast(table, 'UPDATE', next, { id: old.id })
    if (table === 'projects' && patch.status && patch.status !== old.status) {
      this.insertRow('project_status_history', { project_id: id, from_status: old.status, to_status: patch.status }, actor)
    }
    return next
  }

  deleteRow(table, id) {
    const i = this.db[table].findIndex((r) => r.id === id)
    if (i === -1) return null
    if (table === 'companies' && this.db.projects.some((p) => p.company_id === id)) {
      return { error: { status: 409, code: '23503', message: 'update or delete on table "companies" violates foreign key constraint' } }
    }
    const [row] = this.db[table].splice(i, 1)
    this.broadcast(table, 'DELETE', null, { id: row.id })
    // ON DELETE CASCADE karşılıkları
    if (table === 'companies') for (const c of this.db.contacts.filter((x) => x.company_id === id)) this.deleteRow('contacts', c.id)
    if (table === 'projects') {
      for (const t of ['project_notes', 'project_files', 'project_status_history']) {
        for (const r of this.db[t].filter((x) => x.project_id === id)) this.deleteRow(t, r.id)
      }
    }
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

    if (this.failNext && p.includes(this.failNext.match)) {
      const f = this.failNext
      this.failNext = null
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
      return reply(targets.map((t) => this.updateRow(table, t.id, patch)))
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
