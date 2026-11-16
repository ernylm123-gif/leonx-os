import { Palette, Grid, Scissors, Text, Image, Layout, Heart, Star } from 'lucide-react'
import { motion } from 'framer-motion'
import { usePreferences } from '@/context/preferences'

export function VisionBoard(): JSX.Element {
  const { preferences } = usePreferences()

  const templates = [
    { id: '1', name: 'Kahve Molası', description: 'Kahve içme fırsatı', theme: 'warm' },
    { id: '2', name: 'Yıl Sonu Özeti', description: 'Geçen yılın en iyi anları', theme: 'cool' },
    { id: '3', name: 'Motivasyon Boards', description: 'Hedefler ve motivasyon', theme: 'warm' },
  ]

  const elements = [
    { id: '1', type: 'image', src: '/placeholder.svg', alt: 'Resim 1' },
    { id: '2', type: 'text', content: 'Hayal Et. Planla. Gerçekleştir.' },
    { id: '3', type: 'shape', form: 'reactangle' },
  ]

  return (
    <section className="p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <h3 className="text-[--font-size] font-semibold mb-4">Şablonlar</h3>
          <div className="space-y-3">
            {templates.map((template) => (
              <motion.div
                key={template.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className={cn(
                  'bg-[--card] border border-[--border] rounded-lg p-4 cursor-pointer hover:bg-[--hover] transition-colors',
                  'shadow-sm'
                )}
              >
                <div className="h-12 flex items-center justify-center">
                  <template.icon className="h-5 w-5" />
                </div>
                <h4 className="text-sm font-medium">{template.name}</h4>
                <p className="text-xs text-muted-foreground">{template.description}</p>
              </motion.div>
            ))}
          </div>
        </div>

        <div>
          <h3 className="text-[--font-size] font-semibold mb-4">Duvar Kağıdı Boyutları</h3>
          <div className="grid grid-cols-2 gap-2">
            <button className="rounded-md p-3 text-center font-medium hover:bg-[--accent]">
              1080 × 1920 (Mobil)
            </button>
            <button className="rounded-md p-3 text-center font-medium hover:bg-[--accent]">
              1080 × 1080 (Instagram)
            </button>
            <button className="rounded-md p-3 text-center font-medium hover:bg-[--accent]">
              1500 × 1500 (Kare)
            </button>
            <button className="rounded-md p-3 text-center font-medium hover:bg-[--accent]">
              2048 × 2048 (HD)
            </button>
          </div>

          <h4 className="text-[--font-size] font-medium mt-3">Elementler</h4>
          <div className="grid grid-cols-3 gap-2 mt-2">
            <button className="rounded-sm p-2 hover:bg-[--accent]/10 transition-colors">
              <Image className="h-4 w-4" />
            </button>
            <button className="rounded-sm p-2 hover:bg-[--accent]/10 transition-colors">
              <Text className="h-4 w-4" />
            </button>
            <button className="rounded-sm p-2 hover:bg-[--accent]/10 transition-colors">
              <Palette className="h-4 w-4" />
            </button>
            <button className="rounded-sm p-2 hover:bg-[--accent]/10 transition-colors">
              <Heart className="h-4 w-4" />
            </button>
            <button className="rounded-sm p-2 hover:bg-[--accent]/10 transition-colors">
              <Star className="h-4 w-4" />
            </button>
            <button className="rounded-sm p-2 hover:bg-[--accent]/10 transition-colors">
              <Layout className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}