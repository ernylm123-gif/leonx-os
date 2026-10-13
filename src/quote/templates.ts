/**
 * Hazır metin şablonları — kullanıcı seçer ve dilediği gibi düzenler. Fiyat veya müşteri bilgisi
 * içermez; yalnızca sık kullanılan ifadeleri hızlı girmek içindir.
 */

export const ITEM_TEMPLATES: { label: string; description: string; system_type: string; unit: 'm2' | 'mtul' | 'adet' | 'takim' | 'goturu' }[] = [
  { label: 'Alüminyum pencere', description: 'Isı yalıtımlı alüminyum pencere, çift cam, montaj dahil', system_type: 'Alüminyum doğrama', unit: 'm2' },
  { label: 'Alüminyum kapı', description: 'Isı yalıtımlı alüminyum kapı, kilit ve menteşe aksesuarlarıyla', system_type: 'Alüminyum doğrama', unit: 'm2' },
  { label: 'PVC pencere', description: 'PVC pencere, çift cam, iç/dış pervaz ve montaj dahil', system_type: 'PVC doğrama', unit: 'm2' },
  { label: 'PVC kapı', description: 'PVC kapı, aksesuarları ve montaj dahil', system_type: 'PVC doğrama', unit: 'm2' },
  { label: 'Sürme sistem', description: 'Alüminyum sürme doğrama sistemi, çift cam', system_type: 'Sürme sistem', unit: 'm2' },
  { label: 'Giydirme cephe', description: 'Alüminyum giydirme cephe sistemi, cam ve montaj dahil', system_type: 'Cephe', unit: 'm2' },
  { label: 'Kompozit kaplama', description: 'Alüminyum kompozit panel cephe kaplaması, alt konstrüksiyon dahil', system_type: 'Cephe kaplama', unit: 'm2' },
  { label: 'Cam korkuluk', description: 'Alüminyum profilli temperli cam korkuluk', system_type: 'Korkuluk', unit: 'mtul' },
  { label: 'Paslanmaz korkuluk', description: 'Paslanmaz çelik korkuluk, montaj dahil', system_type: 'Korkuluk', unit: 'mtul' },
  { label: 'Çelik kapı', description: 'Çelik kapı, kasa ve aksesuarlarıyla', system_type: 'Kapı', unit: 'adet' },
  { label: 'Fotoselli kapı', description: 'Fotoselli otomatik kapı sistemi, motor ve sensörlerle', system_type: 'Otomatik kapı', unit: 'takim' },
  { label: 'Metal imalat', description: 'Metal imalat işi (çizime göre)', system_type: 'Metal imalat', unit: 'goturu' },
  { label: 'Söküm', description: 'Mevcut doğramaların sökümü ve molozun alan içinde toplanması', system_type: 'Hizmet', unit: 'adet' },
]

export const PAYMENT_TEMPLATES = [
  '%50 sipariş ile peşin, %50 teslimde.',
  '%40 sipariş ile peşin, %40 malzeme sahaya geldiğinde, %20 montaj bitiminde.',
  'Tamamı sipariş ile peşin.',
  'Hakediş usulü, iş ilerlemesine göre aylık ödeme.',
]

export const DELIVERY_TEMPLATES = [
  'Sipariş ve ölçü onayından itibaren 30 iş günü içinde teslim ve montaj.',
  'Sipariş ve ölçü onayından itibaren 45 iş günü içinde teslim ve montaj.',
  'Teslim süresi, ölçü onayı ve avans ödemesinin ardından birlikte belirlenecektir.',
]

export const NOTE_TEMPLATES = [
  'Fiyatlara montaj dahildir; iskele, vinç ve kaba inşaat işleri hariçtir.',
  'Ölçüler yerinde kesin ölçü alınarak teyit edilecektir; metraj farkları birim fiyattan hesaplanır.',
  'Renk ve aksesuar seçimleri sipariş öncesinde yazılı olarak onaylanacaktır.',
  'Elektrik bağlantıları (fotoselli/motorlu sistemler) teklif kapsamı dışındadır.',
]

export const SCOPE_TEMPLATES = [
  'Projeye ait alüminyum doğrama imalatı, camlarının takılması ve yerinde montajı.',
  'PVC doğramaların imalatı, nakliyesi ve montajı.',
  'Cephe sistemi imalatı, alt konstrüksiyon ve montaj işleri.',
  'Korkuluk imalatı ve montajı.',
]
