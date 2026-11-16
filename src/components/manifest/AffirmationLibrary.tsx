import { Heart, Star, Shield } from 'lucide-react'
import { motion } from 'framer-motion'
import { usePreferences } from '@/context/preferences'

const AFFIRMATIONS = {
  confidence: [
    'Ben yeterli. Yeterliliğim artıyor.',
    'Her desafada büyümüyorum.',
    'Güvenim her geçen gün güçleniyor.',
    'I am capable. My capability grows every day.',
    'I handle challenges with grace.',
  ],
  gratitude: [
    'Hayatın küçük luxları için teşekkür ederim.',
    'Bugün için saygılı olma fırsatı buldum.',
    'Kleberilerimle dolu bir günüm oldu.',
    'I am grateful for life\'s small luxuries.',
    'I found an opportunity to be thankful today.',
  ],
  success: [
    'Başarımı tanıyorum.',
    'Hedeflerime ulaşamamı sağlıyorum.',
    'Başarılı olma yeteneğime sahibim.',
    'I acknowledge my success.',
    'I am reaching my goals.',
  ],
}

type Category = 'confidence' | 'gratitude' | 'success'

export function AffirmationLibrary(): JSX.Element {
  const { preferences } = usePreferences()
  const [category, setCategory] = useState<Category>('confidence')
  const [favorites, setFavorites] = useState<string[]>([])
  const [showEnglish, setShowEnglish] = useState(false)

  const affirmations = AFFIRMATIONS[category]

  const toggleFavorite = (text: string) => {
    setFavorites(prev => {
      if (prev.includes(text)) return prev.filter(f => f !== text)
      return [...prev, text]
    })
  }

  return (
    <section className="p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <h4 className="text-xs font-medium text-muted-foreground uppercase">Kategori</h4>
          <div className="grid grid-cols-2 gap-1">
            <button
              onClick={() => setCategory('confidence')}
              className={cn('rounded-full px-2 py-1 text-xs font-medium', category === 'confidence' ? 'bg-primary text-primary-foreground' : 'bg-transparent')}
            >
              Güven
            </button>
            <button
              onClick={() => setCategory('gratitude')}
              className={cn('rounded-full px-2 py-1 text-xs font-medium', category === 'gratitude' ? 'bg-primary text-primary-foreground' : 'bg-transparent')}
            >
              Teşekkür
            </button>
          </div>
          <div className="grid grid-cols-2 gap-1 mt-2">
            <button
              onClick={() => setCategory('success')}
              className={cn('rounded-full px-2 py-1 text-xs font-medium', category === 'success' ? 'bg-primary text-primary-foreground' : 'bg-transparent')}
            >
              Başarı
            </button>
          </div>
        </div>

        <div className="bg-[--card] border border-[--border] rounded-lg p-4">
          <h3 className="text-[--font-size] font-semibold mb-3">
            {category === 'confidence' && 'Güven'}
          </h3>
          <div className="space-y-2 max-h-40 overflow-y-auto">
            {affirmations.map((aff, i) => (
              <div
                key={i}
                className={cn(
                  'rounded-sm p-2 transition-colors hover:bg-[--accent]/10',
                  favorites.includes(aff) ? 'bg-[--accent]/10' : ''
                )}
                onClick={() => toggleFavorite(aff)}
              >
                <p className="font-medium text-sm">{aff}</p>
                <button
                  className="text-xs text-[--accent] underline hover:opacity-80"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggleFavorite(aff)
                  }}
                >
                  {favorites.includes(aff) ? 'Kaldır' : 'Ekle'}
                </button>
              </div>
            ))}
          </div>

          {showEnglish && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">English</p>
              {[...new Set(affirmations.map(a => a.split('.')[1].trim() || a))].map((aff, i) => (
                <div
                  key={i}
                  className={cn(
                    'rounded-sm p-2 transition-colors hover:bg-[--accent]/10',
                    favorites.includes(aff) ? 'bg-[--accent]/10' : ''
                  )}
                  onClick={() => toggleFavorite(aff)}
                >
                  <p className="font-small text-sm">{aff}</p>
                  <button
                    className="text-xs text-[--accent] underline hover:opacity-80"
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleFavorite(aff)
                    }}
                  >
                    {favorites.includes(aff) ? 'Kaldır' : 'Ekle'}
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mt-3 pt-3 border-t border-[--border]">
            <p className="text-xs text-muted-foreground">Favoriler: {favorites.length}</p>
          </div>
        </div>
      </div>
    </section>
  )
}