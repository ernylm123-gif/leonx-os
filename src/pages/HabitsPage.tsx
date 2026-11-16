import { Calendar, CheckCircle, Fire, Heart, Leaf, Clock, Music, Target } from 'lucide-react'
import { motion } from 'framer-motion'
import { usePreferences } from '@/context/preferences'

type Habit = {
  id: string
  name: string
  category: 'daily' | 'weekly' | 'monthly'
  completedToday: boolean
  streak: number
}

const HABITS: Habit[] = [
  { id: '1', name: 'Meditation', category: 'daily', completedToday: false, streak: 5 },
  { id: '2', name: 'Reading', category: 'daily', completedToday: true, streak: 12 },
  { id: '3', name: 'Exercise', category: 'daily', completedToday: false, streak: 3 },
  { id: '4', name: 'Water Intake', category: 'daily', completedToday: false, streak: 7 },
  { id: '5', name: 'Gratitude', category: 'weekly', completedToday: false, streak: 2 },
  { id: '6', name: 'Learning', category: 'weekly', completedToday: true, streak: 1 },
]

export function HabitsPage(): JSX.Element {
  const { preferences } = usePreferences()

  const [habits] = useState(() => HABITS)

  const completedToday = habits.filter(h => h.completedToday).length
  const totalStreak = habits.reduce((sum, h) => sum + h.streak, 0)

  return (
    <section className="p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-[--card] border border-[--border] rounded-xl p-6 shadow-sm"
      >
        <h3 className="text-[--font-size] font-semibold mb-4">Sadakati</h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {habits.map((habit) => (
            <motion.div
              key={habit.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className={cn(
                'bg-[--secondary] rounded-md p-4 flex items-center gap-3',
                'text-sm'
              )}
            >
              <Target className="h-4 w-4 text-primary" />
              <div>
                <p className="font-medium">{habit.name}</p>
                <p className="text-xs text-muted-foreground">
                  {habit.streak} gün ardılı
                </p>
              </div>
              <button
                className="rounded-md px-2 py-1 text-xs font-medium hover:bg-[--accent] transition-colors"
                disabled={habit.completedToday}
              >
                {habit.completedToday ? 'Tamam' : 'Tamamla'}
              </button>
              <span className="text-[--accent] opacity-80">
                {habit.completedToday ? '✓' : ''}
              </span>
            </motion.div>
          ))
        </div>

        <div className="mt-6 pt-6 border-t border-[--border]">
          <p className="text-sm text-muted-foreground mb-3">
            Güncel: {completedToday} {completedToday === 1 ? 'gün' : 'gün'} tamamlandı
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="font-medium">Toplam sıra</p>
              <p className="text-xl font-medium">{totalStreak} gün</p>
            </div>
            <div>
              <p className="font-medium">Seri en uzun</p>
              <p className="text-xl font-medium">12 gün</p>
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  )
}