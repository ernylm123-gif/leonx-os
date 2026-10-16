import type { SupabaseClient } from '@supabase/supabase-js'
import type { EngineSystem } from '@/bom/engine'
import type {
  BomAssignment,
  BomLine,
  BomVersion,
  ProductSystem,
  ProductSystemInput,
  SystemComponent,
  SystemComponentInput,
  SystemRule,
  SystemRuleInput,
} from '@/bom/types'
import { fetchAllPages, insertOnce, versionedUpdate } from './api'

/**
 * Malzeme reçetesi veri erişimi. Yetki RLS'te; reçete sürümü yalnız create_bom_version RPC'siyle
 * (tek işlem) oluşturulur, onaylı sürüm kilidi veritabanı tetikleyicisindedir (istemciye güvenilmez).
 */

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

// ------------------------------------------------------------------ Sistem kütüphanesi
export interface SystemLibrary {
  systems: ProductSystem[]
  components: SystemComponent[]
  rules: SystemRule[]
}

export async function loadLibrary(db: SupabaseClient): Promise<SystemLibrary> {
  const [systems, components, rules] = await Promise.all([
    fetchAllPages<ProductSystem>((f, t) => db.from('product_systems').select('*').order('name').order('id').range(f, t)),
    fetchAllPages<SystemComponent>((f, t) => db.from('system_components').select('*').order('sort_order').order('id').range(f, t)),
    fetchAllPages<SystemRule>((f, t) => db.from('system_rules').select('*').order('sort_order').order('id').range(f, t)),
  ])
  return { systems, components, rules }
}

/** Kütüphaneyi motor girdisine çevirir (sayısal alanlar Number'a) */
export function toEngineSystems(lib: SystemLibrary): EngineSystem[] {
  return lib.systems.map((s) => ({
    id: s.id,
    name: s.name,
    active: s.active,
    components: lib.components
      .filter((c) => c.system_id === s.id)
      .map((c) => ({
        id: c.id,
        role: c.role,
        code: c.code,
        name: c.name,
        unit: c.unit,
        standard_length_mm: c.standard_length_mm == null ? null : Number(c.standard_length_mm),
        waste_pct: Number(c.waste_pct ?? 0),
        weight_kg_per_m: c.weight_kg_per_m == null ? null : Number(c.weight_kg_per_m),
        cost_rate_id: c.cost_rate_id,
        sort_order: c.sort_order,
        rules: lib.rules.filter((r) => r.component_id === c.id),
      })),
  }))
}

export const createSystem = (db: SupabaseClient, input: ProductSystemInput & { id?: string }) => insertOnce<ProductSystem>(db, 'product_systems', input)
export const updateSystem = (db: SupabaseClient, s: Pick<ProductSystem, 'id' | 'version'>, patch: Partial<ProductSystemInput>) =>
  versionedUpdate<ProductSystem>(db, 'product_systems', s.id, s.version, patch)
export async function deleteSystem(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('product_systems').delete().eq('id', id).select('id'))
}

export const createComponent = (db: SupabaseClient, input: SystemComponentInput & { system_id: string; id?: string }) => insertOnce<SystemComponent>(db, 'system_components', input)
export const updateComponent = (db: SupabaseClient, c: Pick<SystemComponent, 'id' | 'version'>, patch: Partial<SystemComponentInput>) =>
  versionedUpdate<SystemComponent>(db, 'system_components', c.id, c.version, patch)
export async function deleteComponent(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('system_components').delete().eq('id', id).select('id'))
}

export const createRule = (db: SupabaseClient, input: SystemRuleInput & { component_id: string; id?: string }) => insertOnce<SystemRule>(db, 'system_rules', input)
export const updateRule = (db: SupabaseClient, r: Pick<SystemRule, 'id' | 'version'>, patch: Partial<SystemRuleInput>) =>
  versionedUpdate<SystemRule>(db, 'system_rules', r.id, r.version, patch)
export async function deleteRule(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('system_rules').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Reçete sürümleri
export async function listBomVersions(db: SupabaseClient, projectId: string): Promise<BomVersion[]> {
  return unwrap(await db.from('bom_versions').select('*').eq('project_id', projectId).order('revision', { ascending: false }).limit(500))
}

export async function loadBomVersion(db: SupabaseClient, id: string): Promise<{ assignments: BomAssignment[]; lines: BomLine[] }> {
  const [assignments, lines] = await Promise.all([
    fetchAllPages<BomAssignment>((f, t) => db.from('bom_assignments').select('*').eq('bom_version_id', id).order('sort_order').order('id').range(f, t)),
    fetchAllPages<BomLine>((f, t) => db.from('bom_lines').select('*').eq('bom_version_id', id).order('sort_order').order('id').range(f, t)),
  ])
  return { assignments, lines }
}

/** Sürüm + atama + satırlar tek işlemde (RPC); revizyon numarası sunucuda atanır */
export async function createBomVersion(db: SupabaseClient, projectId: string, takeoffId: string, payload: object): Promise<string> {
  return unwrap(await db.rpc('create_bom_version', { p_project: projectId, p_takeoff: takeoffId, p_payload: payload })) as string
}

export async function approveBomVersion(db: SupabaseClient, id: string): Promise<void> {
  const res = await db.rpc('approve_bom_version', { p_id: id })
  if (res.error) throw res.error
}

export const updateBomVersion = (db: SupabaseClient, v: Pick<BomVersion, 'id' | 'version'>, patch: Partial<Pick<BomVersion, 'notes' | 'status'>>) =>
  versionedUpdate<BomVersion>(db, 'bom_versions', v.id, v.version, patch)

export async function deleteBomVersion(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('bom_versions').delete().eq('id', id).select('id'))
}
