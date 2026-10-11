/** localStorage erişimi; gizli pencere veya engellenmiş depolamada sessizce varsayılana döner. */
export function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? fallback : { ...fallback, ...(JSON.parse(raw) as Partial<T>) }
  } catch {
    return fallback
  }
}

export function writeStorage<T>(key: string, value: T): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* depolama kullanılamıyor — tercih yalnızca bu oturumda geçerli */
  }
}
