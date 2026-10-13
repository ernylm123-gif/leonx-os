import { useEffect, useId, useState, useSyncExternalStore } from 'react'

/**
 * Kaydedilmemiş değişiklik kaydı. Açık formlar ve kaydedilmemiş yerel çalışmalar kendilerini
 * buraya bildirir; sürüm güncellemesi ve sayfa kapatma bu kayda bakarak kullanıcıyı uyarır.
 * İş verisi hiçbir zaman localStorage'a yazılmaz: kalıcı veri yalnızca Supabase'dedir.
 */
const dirty = new Map<string, string>()
const listeners = new Set<() => void>()
let snapshot: string[] = []

function emit() {
  snapshot = [...dirty.values()]
  for (const l of listeners) l()
}

export function setUnsaved(key: string, label: string | null) {
  if (label) dirty.set(key, label)
  else dirty.delete(key)
  emit()
}

export function unsavedLabels(): string[] {
  return snapshot
}

export function subscribeUnsaved(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Bileşen kaydedilmemiş durumdaysa etiketini kaydeder (bileşen kaldırılınca temizlenir) */
export function useUnsavedChanges(isDirty: boolean, label: string) {
  const id = useId()
  useEffect(() => {
    setUnsaved(id, isDirty ? label : null)
    return () => setUnsaved(id, null)
  }, [id, isDirty, label])
}

export function useUnsavedLabels(): string[] {
  return useSyncExternalStore(subscribeUnsaved, unsavedLabels, unsavedLabels)
}

/** Kaydedilmemiş değişiklik varken sekme/pencere kapatılırsa tarayıcı uyarısı */
export function installBeforeUnloadGuard(): () => void {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (dirty.size === 0) return
    e.preventDefault()
    e.returnValue = ''
  }
  window.addEventListener('beforeunload', onBeforeUnload)
  return () => window.removeEventListener('beforeunload', onBeforeUnload)
}

/**
 * Modal formlar için: form açıkken kullanıcı herhangi bir alanı değiştirirse "kaydedilmemiş" sayılır.
 * <form onChangeCapture={markDirty}> ile bağlanır; form kapanınca (kaydedildi/vazgeçildi) temizlenir.
 */
export function useFormDirty(open: boolean, label: string) {
  const [isDirty, setDirty] = useState(false)
  useEffect(() => {
    if (!open) setDirty(false)
  }, [open])
  useUnsavedChanges(open && isDirty, label)
  return { markDirty: () => setDirty(true), isDirty }
}

// ------------------------------------------------------------------ süren işlemler
// Dosya yükleme gibi yarıda kesilmemesi gereken işlemler. Bunlar sürerken sürüm güncellemesi
// ertelenir (yeniden yükleme yüklemeyi yarıda keser ve depoda yarım dosya bırakabilir).
const busy = new Map<string, string>()
const busyListeners = new Set<() => void>()
let busySnapshot: string[] = []

export function setBusy(key: string, label: string | null) {
  if (label) busy.set(key, label)
  else busy.delete(key)
  busySnapshot = [...busy.values()]
  for (const l of busyListeners) l()
}

export function busyLabels(): string[] {
  return busySnapshot
}

function subscribeBusy(fn: () => void): () => void {
  busyListeners.add(fn)
  return () => busyListeners.delete(fn)
}

export function useBusyLabels(): string[] {
  return useSyncExternalStore(subscribeBusy, busyLabels, busyLabels)
}

/** Süren işlemi kaydeder; işlem bitince (hata olsa da) kayıt silinir. */
export async function runBusy<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const key = `${label}:${Math.random().toString(36).slice(2)}`
  setBusy(key, label)
  try {
    return await fn()
  } finally {
    setBusy(key, null)
  }
}
