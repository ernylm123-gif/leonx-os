import { Heart, Leaf, Calendar, Gift, Music, Book, Lightbulb, Clock } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { usePreferences } from '@/context/preferences'

export function JournalPage(): JSX.Element {
  const { preferences } = usePreferences()

  const entries = [
    { id: '1', date: 'Dün', title: 'Gratitude entries', category: 'teşekkür' },
    { id: '2', date: '3 gün önce', title: 'Ritual reflection', category: 'ritüel' },
    { id: '3', date: '1 hafta önce', title: 'Hedef gözden geçirme', category: 'hedef' },
  ]

  return (
    <section className="p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-[--card] border border-[--border] rounded-xl p-6 shadow-sm"
      >
        <h3 className="text-[--font-size] font-semibold mb-4">Özel Günlük</h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {entries.map((entry) => (
            <motion.div
              key={entry.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.1 }}
              className={cn(
                'bg-[--secondary] rounded-md p-3 flex items-center gap-2 cursor-pointer hover:bg-[--accent]/10 transition-colors',
                'text-sm'
              )}
            >
              <entry.icon className="h-4 w-4" />
              <span className="font-medium">{entry.title}</span>
              <span className="text-[--accent] opacity-80 text-xs">-{entry.date}</span>
            </motion.div>
          ))}
        </div>

        <div className="mt-6 pt-6 border-t border-[--border]">
          <h4 className="text-[--font-size] font-medium mb-3">Yeni Giriş</h4>
          <p className="text-sm text-muted-foreground">
            Farklı typelardan seçin: teşekkür, ritüel, hedef, özgür yazı
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[1, 2, 3].map((id) => (
              <button
                key={id}
                className="rounded-md p-2 text-center font-medium hover:bg-[--accent] transition-colors"
              >
                {id}
              </button>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  )
}