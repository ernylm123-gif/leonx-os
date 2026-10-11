import { Compass, Home } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'

export function NotFoundPage() {
  return (
    <div className="panel">
      <EmptyState icon={Compass} title="Sayfa bulunamadı" description="Aradığınız adres LEONX OS içinde mevcut değil.">
        <Link
          to="/"
          className="brushed-silver inline-flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-anthracite-950"
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          Dashboard'a dön
        </Link>
      </EmptyState>
    </div>
  )
}
