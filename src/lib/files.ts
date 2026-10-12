/**
 * Proje dosyası kuralları. Supabase Free planında dosya başına üst sınır 50 MB'dir;
 * bucket ve veritabanı kısıtları da aynı sınırı uygular.
 */
export const MAX_FILE_BYTES = 50 * 1024 * 1024
export const STORAGE_BUCKET = 'project-files'

export const ALLOWED_EXTENSIONS = [
  'pdf', 'jpg', 'jpeg', 'png', 'webp', 'heic', 'heif',
  'dwg', 'dxf',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt',
  'zip',
] as const

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  dwg: 'image/vnd.dwg',
  dxf: 'image/vnd.dxf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv',
  txt: 'text/plain',
  zip: 'application/zip',
}

export const ACCEPT_ATTRIBUTE = ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')

export function fileExtension(name: string): string {
  const i = name.lastIndexOf('.')
  return i > 0 ? name.slice(i + 1).toLowerCase() : ''
}

/** Uzantıya göre içerik türü — tarayıcının bildirdiği türe güvenilmez. */
export function contentTypeFor(name: string): string {
  return MIME_BY_EXT[fileExtension(name)] ?? 'application/octet-stream'
}

export function validateFile(file: { name: string; size: number }): string | null {
  const ext = fileExtension(file.name)
  if (!ext || !(ALLOWED_EXTENSIONS as readonly string[]).includes(ext)) {
    return `Desteklenmeyen dosya türü. İzin verilenler: ${ALLOWED_EXTENSIONS.join(', ').toUpperCase()}`
  }
  if (file.size <= 0) return 'Dosya boş.'
  if (file.size > MAX_FILE_BYTES) return `Dosya ${formatBytes(MAX_FILE_BYTES)} sınırını aşıyor (${formatBytes(file.size)}).`
  if (file.name.length > 255) return 'Dosya adı çok uzun.'
  return null
}

/**
 * Depolama için güvenli nesne adı: Türkçe karakterleri sadeleştirir, yol ayırıcılarını
 * ve özel karakterleri kaldırır. Görünen ad veritabanında ayrıca saklanır.
 */
export function safeObjectName(name: string): string {
  const ext = fileExtension(name)
  const base = (ext ? name.slice(0, -(ext.length + 1)) : name)
    .replace(/ç/g, 'c').replace(/Ç/g, 'C').replace(/ğ/g, 'g').replace(/Ğ/g, 'G')
    .replace(/ı/g, 'i').replace(/İ/g, 'I').replace(/ö/g, 'o').replace(/Ö/g, 'O')
    .replace(/ş/g, 's').replace(/Ş/g, 'S').replace(/ü/g, 'u').replace(/Ü/g, 'U')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80) || 'dosya'
  return ext ? `${base}.${ext}` : base
}

export function storagePathFor(projectId: string, fileName: string, uniqueId: string): string {
  return `${projectId}/${uniqueId}-${safeObjectName(fileName)}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace('.', ',')} KB`
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}
