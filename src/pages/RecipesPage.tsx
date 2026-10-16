import { Boxes, Layers, ListTree } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '@/components/ui/PageHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { ProjectBom } from '@/features/bom/ProjectBom'
import { SystemLibrary } from '@/features/bom/SystemLibrary'

type Section = 'proje' | 'sistemler'
const SECTIONS: { value: Section; label: string; icon: typeof Layers }[] = [
  { value: 'proje', label: 'Proje reçetesi', icon: Layers },
  { value: 'sistemler', label: 'Sistem kütüphanesi', icon: Boxes },
]

/** Malzeme reçetesi (BOM): onaylı metraj + kullanıcı tanımlı ürün sistemleri → malzeme ihtiyacı */
export function RecipesPage() {
  const [params, setParams] = useSearchParams()
  const section: Section = params.get('bolum') === 'sistemler' ? 'sistemler' : 'proje'
  return (
    <>
      <PageHeader
        icon={ListTree}
        code="M12"
        eyebrow="Mühendislik"
        title="Reçeteler"
        description="Onaylı metrajdaki pozları kendi tanımladığınız ürün sistemleriyle malzeme ihtiyacına, profil kesim listesine ve maliyete dönüştürün. Üretici verisi uydurulmaz."
        status="ready"
      />
      <div className="mb-6 max-w-xl">
        <SegmentedControl
          name="Reçete bölümü"
          value={section}
          options={SECTIONS}
          layoutId="recipes-section"
          onChange={(v) => {
            const p = new URLSearchParams(params)
            if (v === 'proje') p.delete('bolum')
            else p.set('bolum', v)
            setParams(p, { replace: true })
          }}
        />
      </div>
      {section === 'proje' ? <ProjectBom /> : <SystemLibrary />}
    </>
  )
}
