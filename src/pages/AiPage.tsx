import { Bot, FileSearch, Lightbulb, MessageSquareText, SendHorizontal, Sparkles } from 'lucide-react'
import { LeonxSymbol } from '@/components/brand/LeonxLogo'
import { RoadmapPanel } from '@/components/ui/FeatureList'
import { PageHeader } from '@/components/ui/PageHeader'
import { PlannedNotice } from '@/components/ui/PlannedNotice'
import { MILESTONE } from '@/config/company'

export function AiPage() {
  return (
    <>
      <PageHeader
        icon={Bot}
        code="M06"
        eyebrow="Mühendislik"
        title="LEONX AI"
        description="Projeler, çizimler ve teklifler üzerinde çalışacak, LEONX Metal'e özel yapay zekâ asistanı."
        status="planned"
      />

      <PlannedNotice className="mb-6">
        Yapay zekâ entegrasyonu henüz yapılmadı. Bu ekranda mesaj gönderilemez ve yanıt üretilmez.
      </PlannedNotice>

      <section aria-label="Asistan sohbet alanı" className="card flex min-h-[420px] flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkles className="h-4 w-4 text-titanium" aria-hidden="true" />
            Asistan
          </span>
          <span className="font-mono text-[10.5px] text-subtle">BAĞLI DEĞİL</span>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center px-6 py-12 text-center">
          <LeonxSymbol size={72} className="shadow-card" />
          <h2 className="mt-6 text-lg font-semibold text-ink">LEONX AI henüz etkin değil</h2>
          <p className="mt-2 max-w-md text-sm text-muted">
            Entegrasyon tamamlandığında asistan; proje verileri, CAD analiz sonuçları ve metraj listeleri üzerinden soru
            yanıtlayabilecek.
          </p>
        </div>
        <div className="border-t border-line bg-surface-2/60 p-3 sm:p-4">
          <div className="flex items-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface px-3">
            <input
              disabled
              placeholder={`Asistan ${MILESTONE.ai.toLocaleLowerCase('tr-TR')} ile etkinleşecek`}
              aria-label="Mesaj (devre dışı)"
              className="h-12 min-w-0 flex-1 cursor-not-allowed bg-transparent text-base text-muted placeholder:text-subtle sm:text-sm"
            />
            <button
              type="button"
              disabled
              className="grid h-9 w-9 shrink-0 cursor-not-allowed place-items-center rounded-lg text-subtle"
              aria-label="Gönder (devre dışı)"
            >
              <SendHorizontal className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      <RoadmapPanel
        items={[
          { icon: MessageSquareText, title: 'Proje asistanı', description: 'Proje durumu ve geçmişi hakkında doğal dilde sorgulama.' },
          { icon: FileSearch, title: 'Çizim yorumlama', description: 'CAD analiz çıktılarındaki belirsizlikler için öneriler.' },
          { icon: Lightbulb, title: 'Teklif kontrolleri', description: 'Benzer geçmiş işlere göre kontrol listeleri.' },
        ]}
      />
    </>
  )
}
