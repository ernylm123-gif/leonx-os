import { ScanLine } from 'lucide-react'
import { CadWorkspace } from '@/features/cad/workspace/CadWorkspace'

export function CadAnalysisPage() {
  return (
    <>
      <header className="mb-4 flex min-w-0 items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-line bg-surface shadow-card">
          <ScanLine className="h-[18px] w-[18px] text-titanium" strokeWidth={1.75} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[10.5px] tracking-[0.12em] text-subtle uppercase">M02 · Mühendislik</div>
          <h1 className="truncate text-lg font-semibold text-ink">CAD Analiz</h1>
        </div>
      </header>
      <CadWorkspace />
    </>
  )
}
