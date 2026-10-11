import { Compass, Home } from 'lucide-react'
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/ui/EmptyState'

export function NotFoundPage() {
  return (
    <div className="card">
      <EmptyState icon={Compass} title="Sayfa bulunamadı" description="Aradığınız adres LEONX OS içinde mevcut değil.">
        <Link
          to="/"
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-ink shadow-card transition hover:bg-primary-hover"
        >
          <Home className="h-4 w-4" aria-hidden="true" />
          Dashboard'a dön
        </Link>
      </EmptyState>
    </div>
  )
}
