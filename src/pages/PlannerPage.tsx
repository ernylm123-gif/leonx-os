import { Calendar, Clock, Layout, Shield, GraduationCap, Map, Globe, Music, Heart, Star } from 'lucide-react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { usePreferences } from '@/context/preferences'

export function PlannerPage(): JSX.Element {
  const { preferences } = usePreferences()
  const today = new Date()

  const daysOfWeek = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi']
  const currentDay = daysOfWeek[today.getDay()]

  const monthlyView = [
    { day: 1, name: 'Yıl Başlangıcı', focus: 'Strategi planlar' },
    { day: 15, name: 'Yıl İğncesi', focus: 'Half-year review' },
    { day: 30, name: 'Ay Sonu', focus: 'Ay review & plan' },
  ]

  return (
    <section className="p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="bg-[--card] border border-[--border] rounded-xl p-6 shadow-sm"
      >
        <h3 className="text-[--font-size] font-semibold mb-4">Hayat Planlayıcı</h3>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Today */}
          <div>
            <h4 className="text-sm text-muted-foreground">{currentDay}, {today.getDate}. {today.toLocaleDateString('tr-TR', { month: 'long' })}</h4>
            <p className="text-xl font-medium mt-2">Başlangıç</p>
          </div>

          {/* Weekly Focus */}
          <div>
            <h4 className="text-sm text-muted-foreground">Bu Hafta</h4>
            <p className="text-xl font-medium mt-2">3 hedef</p>
          </div>

          {/* Monthly Focus */}
          <div>
            <h4 className="text-sm text-muted-foreground">Bu Ay</h4>
            <p className="text-xl font-medium mt-2">Projeler</p>
          </div>
        </div>

        {/* Monthly Calendar Preview */}
        <div className="mt-6 pt-6 border-t border-[--border]">
          <h4 className="text-[--font-size] font-medium mb-3">Ay Görüntüsü</h4>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            <div>Pz</div>
            <div>Sal</div>
            <div>Çar</div>
            <div>Per</div>
            <div>Cum</div>
            <div>Cts</div>
            <div>Paz</div>
          </div>
          <div className="grid grid-cols-7 gap-2 mt-2">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31].map(day => (
              <div key={day} className="bg-[--secondary] rounded-md py-1">{day > 25 ? day : ''}</div>
            ))}
          </div>
        </div>
      </motion.div>
    </section>
  )
}