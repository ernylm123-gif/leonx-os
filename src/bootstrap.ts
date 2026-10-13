import { cleanReloadParam, purgeLegacyCaches } from '@/lib/appVersion'

/**
 * Uygulama kodundan (yönlendirici dahil) önce çalışır — main.tsx'te ilk içe aktarmadır.
 * 1) Güncelleme sonrası eklenen sürüm parametresini adresten kaldırır.
 * 2) Önceki kurulumlardan kalmış service worker / Cache Storage'ı temizler (LEONX OS bunları
 *    kullanmaz; kalmışsa eski dosyaları verebilir). Oturum ve tercihler etkilenmez.
 */
try {
  const clean = cleanReloadParam(window.location.href)
  if (clean) window.history.replaceState(window.history.state, '', clean)
} catch {
  /* yok say */
}
void purgeLegacyCaches()
