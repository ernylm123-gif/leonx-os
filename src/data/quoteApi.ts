import type { SupabaseClient } from '@supabase/supabase-js'
import type { Quote, QuoteHistoryEntry, QuoteInput, QuoteItem, QuoteItemInput, QuoteSettings, QuoteSettingsInput, QuoteStatus } from '@/quote/types'
import { ConflictError, fetchAllPages, insertManyOnce, insertOnce, LIST_LIMIT, versionedUpdate } from './api'

/**
 * Teklif veri erişimi. Numara, kilit ve revizyon kuralları veritabanında uygulanır
 * (supabase/migrations/20261013000600_leonx_quotes.sql); istemciye güvenilmez.
 */

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

/** Liste için kalem alanları (toplam hesabı) */
const ITEM_TOTAL_COLUMNS =
  'id,quote_id,sort_order,quantity,unit,width_mm,height_mm,manual_measure,material_cost,labor_cost,install_cost,other_cost,unit_price,measure_verified'

export async function listQuotes(db: SupabaseClient): Promise<Quote[]> {
  return unwrap(
    await db
      .from('quotes')
      .select('*')
      .order('quote_date', { ascending: false })
      .order('quote_no', { ascending: false })
      .order('revision', { ascending: false })
      .range(0, LIST_LIMIT - 1),
  )
}

/** Tüm tekliflerin kalemleri (liste toplamları için yalnız hesap alanları) */
export async function listAllQuoteItems(db: SupabaseClient): Promise<QuoteItem[]> {
  return (await fetchAllPages((from, to) => db.from('quote_items').select(ITEM_TOTAL_COLUMNS).order('id').range(from, to))) as unknown as QuoteItem[]
}

export async function getQuote(db: SupabaseClient, id: string): Promise<Quote | null> {
  return unwrap(await db.from('quotes').select('*').eq('id', id).maybeSingle())
}

export async function listQuoteRevisions(db: SupabaseClient, rootId: string): Promise<Quote[]> {
  return unwrap(await db.from('quotes').select('*').eq('root_id', rootId).order('revision', { ascending: false }))
}

export async function listQuotesBy(db: SupabaseClient, key: 'project_id' | 'company_id', id: string): Promise<Quote[]> {
  return unwrap(await db.from('quotes').select('*').eq(key, id).order('quote_date', { ascending: false }).order('revision', { ascending: false }).limit(500))
}

export async function createQuote(db: SupabaseClient, input: QuoteInput): Promise<Quote> {
  return insertOnce<Quote>(db, 'quotes', input)
}

const MISSING_COLUMN = new Set(['PGRST204', '42703'])

/** 017: fırsata bağlı teklif (revizyonlar bağı taşımaz; ilk taslak döner). Sütun yoksa (017 öncesi) null. */
export async function findOpportunityQuote(db: SupabaseClient, opportunityId: string): Promise<Quote | null> {
  const r = await db.from('quotes').select('*').eq('radar_opportunity_id', opportunityId).limit(1)
  if (r.error) {
    if (MISSING_COLUMN.has((r.error as { code?: string }).code ?? '')) return null
    throw r.error
  }
  return ((r.data ?? []) as Quote[])[0] ?? null
}

/**
 * Fırsattan teklif taslağı — fırsat başına tek teklif (veritabanında benzersiz; iki cihaz aynı anda
 * bassa da ikinci taslak açılmaz, mevcut olan döner). Kalem/fiyat EKLENMEZ.
 */
export async function createQuoteForOpportunity(db: SupabaseClient, opportunityId: string, input: QuoteInput): Promise<{ quote: Quote; existing: boolean }> {
  const found = await findOpportunityQuote(db, opportunityId)
  if (found) return { quote: found, existing: true }
  try {
    return { quote: await insertOnce<Quote>(db, 'quotes', { ...input, radar_opportunity_id: opportunityId }), existing: false }
  } catch (e) {
    const code = (e as { code?: string }).code ?? ''
    if (code === '23505') {
      const q = await findOpportunityQuote(db, opportunityId)
      if (q) return { quote: q, existing: true }
    }
    // 017 uygulanmamış veritabanı: bağ kurulmadan oluşturulur (eski davranış)
    if (MISSING_COLUMN.has(code)) return { quote: await insertOnce<Quote>(db, 'quotes', input), existing: false }
    throw e
  }
}

export function updateQuote(db: SupabaseClient, q: Pick<Quote, 'id' | 'version'>, patch: Partial<QuoteInput> & { status?: QuoteStatus; project_id?: string | null }): Promise<Quote> {
  return versionedUpdate<Quote>(db, 'quotes', q.id, q.version, patch)
}

export async function deleteQuote(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('quotes').delete().eq('id', id).select('id'))
}

/** Revizyon (aynı numara, kaynak kilitlenir) veya kopya (yeni numara). Yeni teklifin kimliğini döner. */
export async function copyQuote(db: SupabaseClient, sourceId: string, mode: 'revizyon' | 'kopya'): Promise<string> {
  const res = await db.rpc('copy_quote', { p_source: sourceId, p_mode: mode })
  if (res.error) throw res.error
  return res.data as string
}

// ------------------------------------------------------------------ kalemler
export async function listQuoteItems(db: SupabaseClient, quoteId: string): Promise<QuoteItem[]> {
  return unwrap(await db.from('quote_items').select('*').eq('quote_id', quoteId).order('sort_order', { ascending: true }).order('created_at', { ascending: true }))
}

/** Birden çok teklifin kalemleri tek sorguda (teklif başına ayrı istek atmamak için); sıra listQuoteItems ile aynı */
export async function listQuoteItemsFor(db: SupabaseClient, quoteIds: string[]): Promise<QuoteItem[]> {
  if (!quoteIds.length) return []
  return fetchAllPages<QuoteItem>((from, to) =>
    db
      .from('quote_items')
      .select('*')
      .in('quote_id', quoteIds)
      .order('quote_id', { ascending: true })
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to),
  )
}

function toRow(i: Partial<QuoteItemInput>): Partial<QuoteItemInput> {
  const out = { ...i }
  if (out.description != null) out.description = out.description.trim()
  if (out.poz_code != null) out.poz_code = out.poz_code.trim() || null
  if (out.system_type != null) out.system_type = out.system_type.trim() || null
  if (out.notes != null) out.notes = out.notes.trim() || null
  return out
}

export async function createQuoteItems(db: SupabaseClient, quoteId: string, inputs: QuoteItemInput[]): Promise<QuoteItem[]> {
  if (inputs.length === 0) return []
  return insertManyOnce<QuoteItem>(
    db,
    'quote_items',
    inputs.map((i) => ({ ...toRow(i), quote_id: quoteId })),
  )
}

export function updateQuoteItem(db: SupabaseClient, item: Pick<QuoteItem, 'id' | 'version'>, patch: Partial<QuoteItemInput>): Promise<QuoteItem> {
  return versionedUpdate<QuoteItem>(db, 'quote_items', item.id, item.version, toRow(patch))
}

export async function deleteQuoteItems(db: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  unwrap(await db.from('quote_items').delete().in('id', ids).select('id'))
}

// ------------------------------------------------------------------ geçmiş ve ayarlar
export async function listQuoteHistory(db: SupabaseClient, rootId: string): Promise<QuoteHistoryEntry[]> {
  return unwrap(await db.from('quote_history').select('*').eq('root_id', rootId).order('changed_at', { ascending: false }).limit(200))
}

export async function getQuoteSettings(db: SupabaseClient): Promise<QuoteSettings | null> {
  return unwrap(await db.from('quote_settings').select('*').eq('id', 1).maybeSingle())
}

export async function saveQuoteSettings(db: SupabaseClient, input: QuoteSettingsInput, current: Pick<QuoteSettings, 'version'> | null): Promise<QuoteSettings> {
  if (!current) return insertOnce<QuoteSettings>(db, 'quote_settings', { ...input, id: 1 })
  const res = await db.from('quote_settings').update(input).eq('id', 1).eq('version', current.version).select('*').maybeSingle()
  if (res.error) throw res.error
  if (!res.data) throw new ConflictError('changed')
  return res.data as QuoteSettings
}
