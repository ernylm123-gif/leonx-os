import { Music, Calendar, Clock } from 'lucide-react'
import { motion } from 'framer-motion'
import { usePreferences } from '@/context/preferences'

export function WritingPractice(): JSX.Element {
  const { preferences } = usePreferences()
  const [practice, setPractice] = useState('369')
  const [progress, setProgress] = useState(0)
  const [writing, setWriting] = useState(false)

  const practices = {
    369: { name: '369 Manifestation', desc: '3 defa 9 kelime', days: '21 gün' },
    555: { name: '555 Writing Practice', desc: '555 kelime tekrar', days: '30 gün' },
    gratitude: { name: 'Teşekkür Günlüğü', desc: 'Günlük teşekkür', days: 'sürekli' },
  }

  const handleSave = () => {
    setWriting(false)
    setProgress(prev => Math.min(prev + 10, 100))
  }

  return (
    <section className="p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-[--card] border border-[--border] rounded-xl p-6 shadow-sm"
      >
        <h3 className="text-[--font-size] font-semibold mb-4">
          {practice === '369' ? '369 Manifestation' : practice === '555' ? '555 Writing Practice' : 'Teşekkür Günlüğü'}
        </h3>

        <div className="grid grid-cols-2 gap-3 mb-6">
          {[369, 555, 'gratitude'].map(p => (
            <button
              key={p}
              onClick={() => setPractice(p === 'gratitude' ? 'gratitude' : String(p))}
              className={cn(
                'rounded-md p-3 text-left hover:bg-[--accent] transition-colors',
                practice === String(p) ? 'bg-[--accent] text-[--on-accent]' : ''
              )}
            >
              <span className="font-medium">{practices[p].name}</span>
              <p className="text-xs text-muted-foreground">{practices[p].desc}</p>
            </button>
          ))}
        </div>

        {practice !== 'gratitude' && (
          <div>
            <textarea
              placeholder="Metin gir..."
              rows={2}
              className="w-full rounded-md p-2 border border-[--border] bg-[--input] focus:ring-2 focus:ring-[--accent]"
              onChange={(e) => {/* update text */}}
              disabled={writing}
            />
            <button
              onClick={() => setWriting(true)}
              className="mt-2 rounded-md px-3 py-1 text-xs font-medium hover:bg-[--accent]"
            >
              {writing ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          </div>
        )}

        {practice === 'gratitude' && (
          <div>
            <button
              onClick={() => setProgress(prev => Math.min(prev + 20, 100))}
              className="rounded-md px-3 py-1 text-sm font-medium hover:bg-[--accent] w-full mb-2"
            >
              Teşekkür Kaydet
            </button>
            <div className="w-full h-2 rounded-full bg-[--border] mt-2 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-width"
                style={{ width: `${progress}%` }}
                aria-valuemin="0"
                aria-valuemax="100"
                role="progressbar"
              />
            </div>
            <p className="text-xs text-muted-foreground">{progress}% tamamlandı</p>
          </div>
        )}

        {progress >= 100 && (
          <p className="mt-3 text-primary text-small">Tebrikler! Pratik tamamlandı.</p>
        )}
      </motion.div>
    </section>
  )
}