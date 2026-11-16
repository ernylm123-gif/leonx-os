import { Sun, Moon, Heart, Star, Leaf, Calendar, Music, Keyboard, Palette, Lightbulb, Book, Gift, Timer } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { usePreferences } from '@/context/preferences'
import { useData } from '@/context/data'
import { cn } from '@/lib/cn'

interface ManifestCardProps {
  title: string
  description: string
  icon: React.ComponentType
  href: string
  variant?: 'default' | 'secondary'
}

export function ManifestStudio(): void {
  const { preferences } = usePreferences()

  const cards: ManifestCardProps[] = [
    { title: '369 Manifestation Journal', description: 'Guided morning, afternoon, and evening writing sessions', icon: Book, href: '/manifest/journal', variant: 'default' },
    { title: '555 Writing Practice', description: 'Repetition-based journaling with progress tracking', icon: Music, href: '/manifest/writing', variant: 'default' },
    { title: 'Vision Board Studio', description: 'Visual editor for creating mood boards and compositions', icon: Palette, href: '/manifest/vision-board', variant: 'default' },
    { title: 'Affirmation Library', description: '150+ original affirmations in Turkish and English', icon: Heart, href: '/manifest/affirmations', variant: 'default' },
    { title: 'Manifest Challenges', description: 'Guided programs: 7-Day Gratitude, 21-Day Confidence, 30-Day Goals', icon: Star, href: '/manifest/challenges', variant: 'default' },
    { title: 'Future Self Letters', description: 'Write private letters to your future self', icon: Gift, href: '/manifest/future-self', variant: 'default' },
    { title: 'Wish Jar', description: 'Interactive digital wish jar', icon: Lightbulb, href: '/manifest/wish-jar', variant: 'default' },
    { title: 'Gratitude Journal', description: 'Daily gratitude practice with calendar browsing', icon: Leaf, href: '/manifest/gratitude', variant: 'default' },
    { title: 'Ritual Builder', description: 'Design personalized morning, midday, and evening rituals', icon: Lightbulb, href: '/manifest/rituals', variant: 'default' },
  ]

  return (
    <section className="p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <motion.div
            key={card.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: card.title.startsWith('F') ? 0.1 : card.title.startsWith('G') ? 0.2 : 0 }}
            className={cn(
              'group bg-[--card] border border-[--border] rounded-xl p-6 hover:bg-[--hover] transition-colors',
              'shadow-sm hover:shadow-md'
            )}
          >
            <div className="h-12 flex items-center justify-center mb-4">
              <card.icon className="h-6 w-6" />
            </div>
            <h3 className="text-[--foreground] font-medium mb-1">{card.title}</h3>
            <p className="text-sm text-muted-foreground">{card.description}</p>
            <Link
              to={card.href}
              className="mt-3 inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[--accent]",
              variant={card.variant}
            >
              Başa Çek
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  )
}