import { Sun, Moon, Heart, Star, Leaf, Calendar, Music, Palette, Lightbulb, Book, Gift, Timer, Clock } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { usePreferences } from '@/context/preferences'

interface ManifestCard {
  id: string
  title: string
  description: string
  icon: React.ComponentType
  href: string
  variant?: 'default' | 'secondary'
}

export function ManifestStudio(): JSX.Element {
  const { preferences } = usePreferences()

  const cards: ManifestCard[] = [
    {
      id: '1',
      title: '369 Manifestation Journal',
      description: 'Guided morning, afternoon, and evening writing sessions',
      icon: Book,
      href: '/manifest/journal',
      variant: 'default',
    },
    {
      id: '2',
      title: '555 Writing Practice',
      description: 'Repetition-based journaling with progress tracking',
      icon: Music,
      href: '/manifest/writing',
      variant: 'default',
    },
    {
      id: '3',
      title: 'Vision Board Studio',
      description: 'Visual editor for creating mood boards and compositions',
      icon: Palette,
      href: '/manifest/vision-board',
      variant: 'default',
    },
    {
      id: '4',
      title: 'Affirmation Library',
      description: '150+ original affirmations in Turkish and English',
      icon: Heart,
      href: '/manifest/affirmations',
      variant: 'default',
    },
    {
      id: '5',
      title: 'Manifest Challenges',
      description: 'Guided programs: 7-Day Gratitude, 21-Day Confidence, 30-Day Goals',
      icon: Star,
      href: '/manifest/challenges',
      variant: 'default',
    },
    {
      id: '6',
      title: 'Future Self Letters',
      description: 'Write private letters to your future self',
      icon: Gift,
      href: '/manifest/future-self',
      variant: 'default',
    },
    {
      id: '7',
      title: 'Wish Jar',
      description: 'Interactive digital wish jar',
      icon: Lightbulb,
      href: '/manifest/wish-jar',
      variant: 'default',
    },
    {
      id: '8',
      title: 'Gratitude Journal',
      description: 'Daily gratitude practice with calendar browsing',
      icon: Leaf,
      href: '/manifest/gratitude',
      variant: 'default',
    },
    {
      id: '9',
      title: 'Ritual Builder',
      description: 'Design personalized morning, midday, and evening rituals',
      icon: Lightbulb,
      href: '/manifest/rituals',
      variant: 'default',
    },
  ]

  return (
    <section className="p-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cards.map((card) => (
          <motion.div
            key={card.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="group bg-[--card] border border-[--border] rounded-xl p-6 hover:bg-[--hover] transition-colors shadow-sm hover:shadow-md"
          >
            <div className="h-12 flex items-center justify-center mb-4">
              <card.icon className="h-6 w-6" />
            </div>
            <h3 className="text-[--foreground] font-medium mb-1">{card.title}</h3>
            <p className="text-sm text-muted-foreground">{card.description}</p>
            <Link
              to={card.href}
              className="mt-3 inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[--accent]"
            >
              Başa Çek
            </Link>
          </motion.div>
        ))}
      </div>
    </section>
  )
}