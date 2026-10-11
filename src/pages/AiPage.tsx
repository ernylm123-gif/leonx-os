import { Bot, FileSearch, Lightbulb, MessageSquareText, SendHorizontal, Sparkles } from 'lucide-react'
import { FeatureList } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { Panel } from '@/components/ui/Panel'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { LeonxMark } from '@/components/brand/LeonxLogo'

export function AiPage() {
  return (
    <>
      <PageHeader
        icon={Bot}
        eyebrow="Mühendislik"
        title="LEONX AI"
        description="Projeler, çizimler ve teklifler üzerinde çalışan, LEONX Metal'e özel yapay zekâ asistanı."
        status="planned"
      />

      <PlannedNotice className="mb-6">
        Yapay zekâ entegrasyonu henüz yapılmadı (Faz 6). Bu ekranda mesaj gönderilemez ve yanıt üretilmez.
      </PlannedNotice>

      <section aria-label="Asistan sohbet alanı" className="panel flex min-h-[420px] flex-col overflow-hidden">
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <div className="relative">
            <div className="absolute -inset-4 rounded-full bg-silver-300/10 blur-2xl" aria-hidden="true" />
            <LeonxMark className="relative h-16 w-16" />
          </div>
          <h2 className="mt-6 text-lg font-semibold text-silver-50">LEONX AI henüz etkin değil</h2>
          <p className="mt-2 max-w-md text-sm text-titanium-400">
            Entegrasyon tamamlandığında asistan; proje verileri, CAD analiz sonuçları ve metraj listeleri üzerinden soru
            yanıtlayabilecek.
          </p>
        </div>
        <div className="border-t border-white/[0.06] p-3 sm:p-4">
          <div className="flex items-center gap-2 rounded-xl border border-white/[0.07] bg-anthracite-900/60 px-3 opacity-60">
            <Sparkles className="h-4 w-4 shrink-0 text-titanium-500" aria-hidden="true" />
            <input
              disabled
              placeholder="Asistan Faz 6 ile etkinleşecek"
              aria-label="Mesaj (devre dışı)"
              className="h-12 flex-1 cursor-not-allowed bg-transparent text-sm placeholder:text-titanium-500"
            />
            <button
              type="button"
              disabled
              className="grid h-9 w-9 cursor-not-allowed place-items-center rounded-lg text-titanium-500"
              aria-label="Gönder (devre dışı)"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <Panel title="Planlanan yetenekler" subtitle="Bu modül için yol haritası" className="mt-6">
        <FeatureList
          items={[
            { icon: MessageSquareText, title: 'Proje asistanı', description: 'Proje durumu ve geçmişi hakkında doğal dilde sorgulama.' },
            { icon: FileSearch, title: 'Çizim yorumlama', description: 'CAD analiz çıktılarındaki belirsizlikler için öneriler.' },
            { icon: Lightbulb, title: 'Teklif önerileri', description: 'Benzer geçmiş işlere göre kontrol listeleri.' },
          ]}
        />
      </Panel>
    </>
  )
}
