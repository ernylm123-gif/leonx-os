import type { ReactNode } from 'react'
import { motion } from 'framer-motion'
import { ShieldCheck } from 'lucide-react'
import { LeonxLockup } from '@/components/brand/LeonxLogo'
import { ThemeToggle } from '@/components/layout/ThemeToggle'
import { APP, COMPANY } from '@/config/company'

/** Giriş ve kurulum ekranlarının ortak premium çerçevesi. */
export function AuthShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col bg-canvas lg:flex-row">
      {/* Marka paneli — geniş ekranlarda sol sütun */}
      <aside className="blueprint-grid relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:w-[44%] lg:max-w-[620px] lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div className="pointer-events-none absolute inset-8 rounded-3xl border border-dashed border-line-strong" aria-hidden="true" />
        <div className="relative">
          <LeonxLockup className="w-[220px]" />
        </div>
        <div className="relative max-w-md">
          <div className="font-mono text-[11px] tracking-[0.2em] text-subtle">LEONX OS · v{APP.version}</div>
          <h2 className="mt-3 text-[28px] leading-tight font-semibold tracking-[-0.015em] text-ink xl:text-[32px]">
            Proje ve firma yönetimi, tek güvenli hesapta.
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            Bilgisayar, iPad ve telefonunuzdan aynı hesapla giriş yapın; kayıtlar cihazlar arasında anlık eşitlenir.
          </p>
        </div>
        <div className="relative flex items-center gap-2 text-xs text-subtle">
          <ShieldCheck className="h-4 w-4 text-titanium" aria-hidden="true" />
          {COMPANY.name} — yalnızca yetkili kullanıcı
        </div>
      </aside>

      <main className="relative flex flex-1 flex-col px-5 pt-[calc(20px+env(safe-area-inset-top))] pb-[calc(24px+env(safe-area-inset-bottom))] sm:px-8">
        <div className="flex items-center justify-between">
          <LeonxLockup className="w-[132px] lg:invisible" />
          <ThemeToggle />
        </div>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10"
        >
          {children}
        </motion.div>
        <p className="text-center text-[11px] text-subtle">
          {COMPANY.name} · Yalnızca yetkili kullanım içindir
        </p>
      </main>
    </div>
  )
}
