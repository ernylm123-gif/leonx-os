import { Sun, Moon, Clock, Leaf, Heart, Music } from 'lucide-react'
import { motion } from 'framer-motion'
import { usePreferences } from '@/context/preferences'

export function Rituals(): JSX.Element {
  const { preferences } = usePreferences()

  const rituals = [
    { id: 'morning', name: 'Sabah Ritüeli', time: '08:00', duration: '30 dakika', icon: Sun },
    { id: 'midday', name: 'Öğlen Yansıma', time: '13:00', duration: '20 dakika', icon: Moon },
    { id: 'evening', name: 'Akşam Değerlendirme', time: '20:00', duration: '15 dakika', icon: Clock },
  ]

  const [activeRitual, setActiveRitual] = useState<{ id: string } | null>(null)

  return (
    <section className="p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-[--card] border border-[--border] rounded-xl p-6 shadow-sm"
      >
        <h3 className="text-[--font-size] font-semibold mb-4">Kişisel Ritüeller</h3>

        <div className="grid grid-cols-1 gap-3 mb-6">
          {rituals.map((ritual) => (
            <motion.div
              key={ritual.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: rituals.indexOf(ritual) * 0.1 }}
              className={cn(
                'bg-[--secondary] rounded-md p-4 flex items-center gap-3 cursor-pointer hover:bg-[--accent]/10 transition-colors',
                activeRitual?.id === ritual.id ? 'bg-[--accent]/20' : ''
              )}
              onClick={() => setActiveRitual(ritual.id === activeRitual.id ? null : ritual)}
            >
              <ritual.icon className="h-5 w-5 text-primary" />
              <div>
                <p className="font-medium">{ritual.name}</p>
                <p className="text-xs text-muted-foreground">
                  {ritual.time} · {ritual.duration}
                </p>
              </div>
            </motion.div>
          ))}
        </div>

        {activeRitual && (
          <div className="mt-6 pt-6 border-t border-[--border]">
            <h4 className="text-[--font-size] font-medium mb-3">
              {activeRitual === 'morning' ? 'Sabah Ritüeli' : activeRitual === 'midday' ? 'Öğlen Yansıma' : 'Akşam Değerlendirme'}
            </h4>
            <p className="text-sm text-muted-foreground mb-4">
              Bu ritüeli düzenlemek, gününüzde bilinçli anlar yaratmanıza yardımcı olur.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button className="rounded-md px-3 py-2 text-sm font-medium hover:bg-[--accent]">
                Başla
              </button>
              <button className="rounded-md px-3 py-2 text-sm font-medium hover:bg-[--accent]">
                Tamamla
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </section>
  )
}