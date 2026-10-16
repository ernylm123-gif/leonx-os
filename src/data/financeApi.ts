import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Collection,
  CollectionInput,
  CostLine,
  CostLineInput,
  CostRate,
  CostRateInput,
  Expense,
  ExpenseInput,
  FxRate,
  FxRateInput,
  PaymentScheduleInput,
  PaymentScheduleRow,
  ProjectBudget,
  ProjectBudgetInput,
  ProjectFinanceData,
} from '@/finance/types'
import { ConflictError, fetchAllPages, insertManyOnce, insertOnce, versionedUpdate } from './api'

/**
 * Faz 8 finans veri erişimi. Kurallar (yalnız onaylı metraj, tek metraj revizyonu, kabul edilmiş
 * teklif, tahsilat-taksit para birimi, bütçe aşımı bildirimi) veritabanında uygulanır
 * (supabase/migrations/20261015001100_leonx_finance.sql); istemciye güvenilmez.
 * Ekleme işlemleri istemcide üretilen kimlikle tekrarlanabilir (çift kayıt oluşmaz).
 */

function unwrap<T>(res: { data: T | null; error: unknown }): T {
  if (res.error) throw res.error
  return res.data as T
}

// ------------------------------------------------------------------ Birim maliyet kataloğu
export async function listCostRates(db: SupabaseClient): Promise<CostRate[]> {
  return fetchAllPages<CostRate>((from, to) => db.from('cost_rates').select('*').order('code').order('valid_from', { ascending: false }).order('id').range(from, to))
}
export function createCostRate(db: SupabaseClient, input: CostRateInput & { id?: string }): Promise<CostRate> {
  return insertOnce<CostRate>(db, 'cost_rates', input)
}
export function updateCostRate(db: SupabaseClient, r: Pick<CostRate, 'id' | 'version'>, patch: Partial<CostRateInput>): Promise<CostRate> {
  return versionedUpdate<CostRate>(db, 'cost_rates', r.id, r.version, patch)
}
export async function deleteCostRate(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('cost_rates').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Kurlar
export async function listFxRates(db: SupabaseClient): Promise<FxRate[]> {
  return fetchAllPages<FxRate>((from, to) => db.from('fx_rates').select('*').order('rate_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to))
}
export function createFxRate(db: SupabaseClient, input: FxRateInput & { id?: string }): Promise<FxRate> {
  return insertOnce<FxRate>(db, 'fx_rates', input)
}
export async function deleteFxRate(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('fx_rates').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Proje finans verisi
export async function getProjectFinance(db: SupabaseClient, projectId: string): Promise<ProjectFinanceData> {
  const [budget, lines, expenses, schedule, collections] = await Promise.all([
    db.from('project_budgets').select('*').eq('project_id', projectId).maybeSingle(),
    fetchAllPages<CostLine>((from, to) => db.from('project_cost_lines').select('*').eq('project_id', projectId).order('sort_order').order('created_at').order('id').range(from, to)),
    fetchAllPages<Expense>((from, to) => db.from('project_expenses').select('*').eq('project_id', projectId).order('expense_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to)),
    fetchAllPages<PaymentScheduleRow>((from, to) => db.from('project_payment_schedule').select('*').eq('project_id', projectId).order('due_date').order('sort_order').order('id').range(from, to)),
    fetchAllPages<Collection>((from, to) => db.from('project_collections').select('*').eq('project_id', projectId).order('received_date', { ascending: false }).order('created_at', { ascending: false }).order('id').range(from, to)),
  ])
  return {
    budget: unwrap(budget) as ProjectBudget | null,
    lines,
    expenses,
    schedule,
    collections,
  }
}

/** Tüm projelerin finans verisi (panel) — proje kimliğine göre gruplanmış */
export async function listAllFinance(db: SupabaseClient): Promise<Map<string, ProjectFinanceData>> {
  const [budgets, lines, expenses, schedule, collections] = await Promise.all([
    fetchAllPages<ProjectBudget>((from, to) => db.from('project_budgets').select('*').order('id').range(from, to)),
    fetchAllPages<CostLine>((from, to) => db.from('project_cost_lines').select('*').order('sort_order').order('id').range(from, to)),
    fetchAllPages<Expense>((from, to) => db.from('project_expenses').select('*').order('id').range(from, to)),
    fetchAllPages<PaymentScheduleRow>((from, to) => db.from('project_payment_schedule').select('*').order('due_date').order('id').range(from, to)),
    fetchAllPages<Collection>((from, to) => db.from('project_collections').select('*').order('id').range(from, to)),
  ])
  const out = new Map<string, ProjectFinanceData>()
  const of = (pid: string) => {
    let d = out.get(pid)
    if (!d) {
      d = { budget: null, lines: [], expenses: [], schedule: [], collections: [] }
      out.set(pid, d)
    }
    return d
  }
  for (const b of budgets) of(b.project_id).budget = b
  for (const l of lines) of(l.project_id).lines.push(l)
  for (const e of expenses) of(e.project_id).expenses.push(e)
  for (const s of schedule) of(s.project_id).schedule.push(s)
  for (const c of collections) of(c.project_id).collections.push(c)
  return out
}

// ------------------------------------------------------------------ Bütçe
/** Bütçeyi oluşturur veya günceller. Başka cihaz aynı anda oluşturduysa çakışma bildirilir (sessizce ezilmez). */
export async function saveBudget(db: SupabaseClient, input: ProjectBudgetInput, current: Pick<ProjectBudget, 'id' | 'version'> | null): Promise<ProjectBudget> {
  if (current) {
    const { project_id: _fixed, ...patch } = input
    return versionedUpdate<ProjectBudget>(db, 'project_budgets', current.id, current.version, patch)
  }
  try {
    return await insertOnce<ProjectBudget>(db, 'project_budgets', input)
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new ConflictError('changed')
    throw e
  }
}

// ------------------------------------------------------------------ Tahmini maliyet satırları
export function createCostLines(db: SupabaseClient, inputs: (CostLineInput & { id?: string })[]): Promise<CostLine[]> {
  if (inputs.length === 0) return Promise.resolve([])
  return insertManyOnce<CostLine>(db, 'project_cost_lines', inputs)
}
export function updateCostLine(db: SupabaseClient, l: Pick<CostLine, 'id' | 'version'>, patch: Partial<CostLineInput>): Promise<CostLine> {
  return versionedUpdate<CostLine>(db, 'project_cost_lines', l.id, l.version, patch)
}
export async function deleteCostLines(db: SupabaseClient, ids: string[]): Promise<void> {
  if (ids.length === 0) return
  unwrap(await db.from('project_cost_lines').delete().in('id', ids).select('id'))
}

// ------------------------------------------------------------------ Giderler
export function createExpense(db: SupabaseClient, input: ExpenseInput & { id?: string }): Promise<Expense> {
  return insertOnce<Expense>(db, 'project_expenses', input)
}
export function updateExpense(db: SupabaseClient, e: Pick<Expense, 'id' | 'version'>, patch: Partial<ExpenseInput>): Promise<Expense> {
  return versionedUpdate<Expense>(db, 'project_expenses', e.id, e.version, patch)
}
export async function deleteExpense(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('project_expenses').delete().eq('id', id).select('id'))
}

// ------------------------------------------------------------------ Ödeme planı ve tahsilatlar
export function createScheduleRow(db: SupabaseClient, input: PaymentScheduleInput & { id?: string }): Promise<PaymentScheduleRow> {
  return insertOnce<PaymentScheduleRow>(db, 'project_payment_schedule', input)
}
export function updateScheduleRow(db: SupabaseClient, s: Pick<PaymentScheduleRow, 'id' | 'version'>, patch: Partial<PaymentScheduleInput>): Promise<PaymentScheduleRow> {
  return versionedUpdate<PaymentScheduleRow>(db, 'project_payment_schedule', s.id, s.version, patch)
}
export async function deleteScheduleRow(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('project_payment_schedule').delete().eq('id', id).select('id'))
}
export function createCollection(db: SupabaseClient, input: CollectionInput & { id?: string }): Promise<Collection> {
  return insertOnce<Collection>(db, 'project_collections', input)
}
export function updateCollection(db: SupabaseClient, c: Pick<Collection, 'id' | 'version'>, patch: Partial<CollectionInput>): Promise<Collection> {
  return versionedUpdate<Collection>(db, 'project_collections', c.id, c.version, patch)
}
export async function deleteCollection(db: SupabaseClient, id: string): Promise<void> {
  unwrap(await db.from('project_collections').delete().eq('id', id).select('id'))
}
