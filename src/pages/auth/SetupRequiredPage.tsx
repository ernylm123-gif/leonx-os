import { AlertTriangle, Settings2 } from 'lucide-react'
import { AuthShell } from '@/components/layout/AuthShell'
import { FormAlert } from '@/components/ui/Field'
import { supabaseConfig } from '@/lib/supabase'

/** Ortam değişkenleri eksik veya hatalıysa gösterilir; hiçbir ağ isteği yapılmaz. */
export function SetupRequiredPage() {
  const cfg = supabaseConfig
  return (
    <AuthShell>
      <span className="brushed grid h-12 w-12 place-items-center rounded-2xl">
        <Settings2 className="h-5 w-5 text-anthracite" strokeWidth={1.75} aria-hidden="true" />
      </span>
      <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.015em] text-ink">Kurulum gerekli</h1>
      <p className="mt-1.5 mb-6 text-sm leading-relaxed text-muted">
        LEONX OS veritabanına bağlanmak için Supabase bağlantı bilgileri tanımlanmalıdır.
      </p>

      {!cfg.ok && (
        <FormAlert tone={cfg.reason === 'secret_key' ? 'error' : 'warn'}>
          <span className="flex gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{cfg.message}</span>
          </span>
        </FormAlert>
      )}

      <ol className="flex flex-col gap-3 text-sm text-ink-2">
        <li className="card p-4">
          <div className="font-mono text-[10.5px] text-subtle">01</div>
          Vercel → Project → <b>Settings → Environment Variables</b> bölümüne şu iki değişkeni ekleyin:
          <ul className="mt-2 flex flex-col gap-1 font-mono text-[12px]">
            {['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'].map((n) => (
              <li key={n} className="flex items-center gap-2">
                <span className="rounded-md border border-line bg-surface-2 px-2 py-0.5">{n}</span>
                {!cfg.ok && cfg.missing?.includes(n) && <span className="text-danger">eksik</span>}
              </li>
            ))}
          </ul>
        </li>
        <li className="card p-4">
          <div className="font-mono text-[10.5px] text-subtle">02</div>
          Değerleri Supabase → <b>Project Settings → API Keys</b> sayfasından alın. Yalnızca <b>publishable</b> anahtarı
          kullanın; <b>secret / service_role</b> anahtarı asla girmeyin.
        </li>
        <li className="card p-4">
          <div className="font-mono text-[10.5px] text-subtle">03</div>
          Değişkenleri kaydettikten sonra Vercel'de <b>Redeploy</b> yapın. Ayrıntılar README'deki "Supabase kurulumu"
          bölümündedir.
        </li>
      </ol>
    </AuthShell>
  )
}
