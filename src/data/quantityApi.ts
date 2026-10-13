import type { SupabaseClient } from '@supabase/supabase-js'
import type { QuantityItem, QuantityItemInput } from '@/quantity/types'
import { ConflictError, LIST_LIMIT } from './api'
import type { CadAnalysis, CadAnalysisInput, QuantityItemHistory, QuantityTakeoff } from './types'

/**
 * CAD analizi ve metraj veri erişimi. Yetki kontrolü veritabanı RLS politikalarındadır;
 * onaylı sürüm kilidi de veritabanı tetikleyicisiyle uygulanır (istemciye güvenilmez).
 */

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

async function versioned<T extends { id: string; version: number }>(db: SupabaseClient, table: string, id: string, version: number, patch: Record<string, unknown>): Promise<T> {
  const res = await db.from(table).update(patch).eq('id', id).eq('version', version).select('*').maybeSingle()
  if (res.error) throw res.error
  if (res.data) return res.data as T
  const exists = await db.from(table).select('id').eq('id', id).maybeSingle()
  if (exists.error) throw exists.error
  throw new ConflictError(exists.data ? 'changed' : 'deleted')
}

// ------------------------------------------------------------------ Analizler
export async function listAnalyses(db: SupabaseClient, projectId: string): Promise<CadAnalysis[]> {
  return unwrap(await db.from('cad_analyses').select('*').eq('project_id', projectId).order('created_at', { ascending: false }).limit(200))
}

export async function createAnalysis(db: SupabaseClient, input: CadAnalysisInput): Promise<CadAnalysis> {
  return unwrap(await db.from('cad_analyses').insert(input).select('*').single())
}

export async function deleteAnalysis(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('cad_analyses').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Metraj sürümleri
export async function listTakeoffs(db: SupabaseClient, projectId: string): Promise<QuantityTakeoff[]> {
  return unwrap(await db.from('quantity_takeoffs').select('*').eq('project_id', projectId).order('revision', { ascending: false }).limit(200))
}

export async function getTakeoff(db: SupabaseClient, id: string): Promise<QuantityTakeoff | null> {
  return unwrap(await db.from('quantity_takeoffs').select('*').eq('id', id).maybeSingle())
}

/** Yeni boş sürüm. Revizyon numarası çakışırsa (başka cihaz aynı anda oluşturduysa) bir kez yeniden denenir. */
export async function createTakeoff(db: SupabaseClient, projectId: string, name: string, analysisId: string | null = null): Promise<QuantityTakeoff> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const next = await db.rpc('next_takeoff_revision', { p_project: projectId })
    if (next.error) throw next.error
    const res = await db
      .from('quantity_takeoffs')
      .insert({ project_id: projectId, name, revision: next.data as number, analysis_id: analysisId })
      .select('*')
      .single()
    if (!res.error) return res.data as QuantityTakeoff
    if ((res.error as { code?: string }).code !== '23505' || attempt === 1) throw res.error
  }
  throw new Error('Metraj sürümü oluşturulamadı')
}

export async function createRevision(db: SupabaseClient, sourceId: string, name: string): Promise<string> {
  const res = await db.rpc('create_takeoff_revision', { p_source: sourceId, p_name: name })
  if (res.error) throw res.error
  return res.data as string
}

export function updateTakeoff(db: SupabaseClient, t: QuantityTakeoff, patch: Partial<Pick<QuantityTakeoff, 'name' | 'notes' | 'status' | 'analysis_id'>>): Promise<QuantityTakeoff> {
  return versioned<QuantityTakeoff>(db, 'quantity_takeoffs', t.id, t.version, patch)
}

export async function deleteTakeoff(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('quantity_takeoffs').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Pozlar
export async function listItems(db: SupabaseClient, takeoffId: string): Promise<QuantityItem[]> {
  return unwrap(
    await db
      .from('quantity_items')
      .select('*')
      .eq('takeoff_id', takeoffId)
      .order('sort_order', { ascending: true })
      .order('poz_code', { ascending: true })
      .range(0, LIST_LIMIT - 1),
  )
}

export async function listProjectItems(db: SupabaseClient, projectId: string): Promise<QuantityItem[]> {
  return unwrap(await db.from('quantity_items').select('*').eq('project_id', projectId).range(0, LIST_LIMIT * 5 - 1))
}

function toRow(input: QuantityItemInput) {
  return { ...input, poz_code: input.poz_code.trim() }
}

export async function createItems(db: SupabaseClient, takeoffId: string, projectId: string, inputs: QuantityItemInput[]): Promise<QuantityItem[]> {
  if (inputs.length === 0) return []
  const rows = inputs.map((i) => ({ ...toRow(i), takeoff_id: takeoffId, project_id: projectId }))
  return unwrap(await db.from('quantity_items').insert(rows).select('*'))
}

export function updateItem(db: SupabaseClient, item: QuantityItem, patch: Partial<QuantityItemInput>): Promise<QuantityItem> {
  return versioned<QuantityItem>(db, 'quantity_items', item.id, item.version, patch.poz_code != null ? { ...patch, poz_code: patch.poz_code.trim() } : patch)
}

export async function deleteItems(db: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  unwrap(await db.from('quantity_items').delete().in('id', ids).select('id'))
}

export async function listItemHistory(db: SupabaseClient, itemId: string): Promise<QuantityItemHistory[]> {
  return unwrap(await db.from('quantity_item_history').select('*').eq('item_id', itemId).order('changed_at', { ascending: false }).limit(100))
}
