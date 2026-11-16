import { Star, Medal, Calendar, Clock, Gift } from 'lucide-react'
import { motion } from 'framer-motion'
import { usePreferences } from '@/context/preferences'

type Challenge = 'gratitude' | 'confidence' | 'self-reflection' | 'habits'

const CHALLENGES: Record<Challenge, { title: string; description: string; duration: string }> = {
  gratitude: {
    title: '7-Day Teşekkür seyahati',
    description: 'Günlük teşekkür notaları ile hayatın güzelliklerini keşfedin.',
    duration: '7 gün',
  },
  confidence: {
    title: '21-Day Güven seyahati',
    description: 'Günlük yansıma ve afirmaionlarla güveni pekiştirin.',
    duration: '21 gün',
  },
  selfReflection: {
    title: '30-Day Hedef clarity seyahati',
    description: 'Aylık hedef belirleme ve izleme pratiği.',
    duration: '30 gün',
  },
  habits: {
    title: '21-Day Olumlu behaviorlar',
    description: 'Sürekli olumlu behaviorlar geliştirme challengedir.',
    duration: '21 gün',
  },
}

export function ChallengeTracker(): JSX.Element {
  const { preferences } = usePreferences()
  const [activeChallenge, setActiveChallenge] = useState<Challenge | null>(null)
  const [day, setDay] = useState(1)
  const [completed, setCompleted] = useState(new Set<number>())

  const challenge = CHALLENGES[activeChallenge || 'gratitude']

  const toggleComplete = () => {
    setCompleted(prev => {
      const newSet = new Set(prev)
      newSet.add(day)
      return newSet
    })
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
          {activeChallenge ? challenge.title : 'Challenge Seç'}
        </h3>

        {activeChallenge && (
          <div className="mb-6">
            <p className="text-sm text-muted-foreground">{challenge.description}</p>
            <div className="mt-4">
              <p className="text-sm">Gün {day} / {challenge.duration}</p>
              <div className="w-full h-2 rounded-full bg-[--border] mt-2 overflow-hidden">
                <div
                  className="h-full bg-primary rounded-full transition-width"
                  style={{ width: `${(day / parseInt(challenge.duration)) * 100}%` }}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  role="progressbar"
                />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                {completed.size}/{parseInt(challenge.duration)} {challenge.duration.includes('gün') ? 'gün' : 'görev'} tamamlandı
              </p>
            </div>
          </div>
        )}

        {activeChallenge && (
          <button
            onClick={() => toggleComplete()}
            className="mt-2 rounded-md px-4 py-2 text-sm font-medium hover:bg-[--accent] w-full"
            disabled={completed.has(day)}
          >
            {completed.has(day) ? 'Tamamlandı' : 'Tamamla'}
          </button>
        )}

        {!activeChallenge && (
          <div>
            <h4 className="text-[--font-size] font-medium mb-3">Challenges</h4>
            <div className="grid grid-cols-2 gap-3">
              {[1, 2, 3, 4].map((_, i) => (
                <motion.button
                  key={i}
                  initial={{ scale: 0.95 }}
                  animate={{ scale: 1 }}
                  transition={{ type: "spring" }}
                  className="rounded-md p-4 text-left hover:bg-[--accent] transition-colors"
                  onClick={() => setActiveChallenge(Object.keys(CHALLENGES)[i - 1] as Challenge)}
                >
                  <span className="font-medium">{CHALLENGES[Object.keys(CHALLENGES)[i - 1] as Challenge].title}</span>
                  <p className="text-xs text-muted-foreground">{CHALLENGES[Object.keys(CHALLENGES)[i - 1] as Challenge].duration}</p>
                </motion.button>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </section>
  )
}