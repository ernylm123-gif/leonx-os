import type { Company, Project } from '@/data/types'
import { isActiveStatus, PROJECT_CATEGORIES, PROJECT_STATUSES, type ProjectCategory, type ProjectStatus } from './domain'

/** Yerel saatle YYYY-MM-DD */
export function localISODate(d: Date = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return localISODate(new Date(y, m - 1, d + days))
}

export interface DashboardStats {
  total: number
  active: number
  completed: number
  companies: number
  overdue: number
  upcoming: Project[]
}

/** Gerçek kayıtlardan özet. Finansal değer üretilmez. */
export function computeStats(projects: Project[], companies: Company[], today = localISODate(), windowDays = 14): DashboardStats {
  const limit = addDays(today, windowDays)
  const active = projects.filter((p) => isActiveStatus(p.status))
  return {
    total: projects.length,
    active: active.length,
    completed: projects.filter((p) => p.status === 'tamamlandi').length,
    companies: companies.length,
    overdue: active.filter((p) => p.due_date !== null && p.due_date < today).length,
    upcoming: active
      .filter((p) => p.due_date !== null && p.due_date >= today && p.due_date <= limit)
      .sort((a, b) => (a.due_date! < b.due_date! ? -1 : a.due_date! > b.due_date! ? 1 : a.code.localeCompare(b.code))),
  }
}

export function countByStatus(projects: Project[]): { value: ProjectStatus; label: string; count: number }[] {
  return PROJECT_STATUSES.map((s) => ({ ...s, count: projects.filter((p) => p.status === s.value).length }))
}

export function countByCategory(projects: Project[]): { value: ProjectCategory; label: string; count: number }[] {
  return PROJECT_CATEGORIES.map((c) => ({ ...c, count: projects.filter((p) => p.category === c.value).length }))
}

export function daysUntil(iso: string, today = localISODate()): number {
  const [y1, m1, d1] = today.split('-').map(Number)
  const [y2, m2, d2] = iso.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000)
}

/** Türkçe duyarlı arama normalizasyonu */
export function normalizeSearch(s: string): string {
  return s
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
}

export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = normalizeSearch(query)
  if (!q) return true
  const hay = normalizeSearch(fields.filter(Boolean).join(' '))
  return q.split(/\s+/).every((part) => hay.includes(part))
}

export const dateFormatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })
export const dateTimeFormatter = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function formatDate(iso: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return dateFormatter.format(new Date(y, m - 1, d))
}

export function formatDateTime(iso: string): string {
  return dateTimeFormatter.format(new Date(iso))
}
