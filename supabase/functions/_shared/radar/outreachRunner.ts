/**
 * LEONX Radar â€” onaylÄ± e-posta kuyruÄŸunu iÅŸler (Edge Function "radar-outreach", hafta iÃ§i saatlik).
 *
 * Bir taslak YALNIZ ÅŸu koÅŸullarÄ±n hepsi saÄŸlanÄ±rsa gÃ¶nderilir (checkEligibility):
 *  sahip taslaÄŸÄ± onayladÄ± Â· ayarlarda otomatik gÃ¶nderim aÃ§Ä±k Â· Gmail (erlindoorkapi@gmail.com) baÄŸlantÄ±sÄ± sunucuda
 *  doÄŸrulandÄ± Â· hukuki dayanak belgelendi Â· alÄ±cÄ± firmanÄ±n kendi alan adÄ±nda, son 180 gÃ¼nde sitesinden
 *  doÄŸrulanmÄ±ÅŸ kurumsal adres Â· ret listesinde deÄŸil Â· gÃ¼nlÃ¼k sÄ±nÄ±r Â· son 90 gÃ¼nde aynÄ± firmaya e-posta yok Â·
 *  projeye ait kaynak kanÄ±tÄ± var Â· kamu kurumu deÄŸil. Ek olarak ortam anahtarÄ± RADAR_OUTREACH_SEND_ENABLED=true
 *  olmadÄ±kÃ§a (acil durdurma) hiÃ§bir ÅŸey gÃ¶nderilmez. GeÃ§meyen taslak kuyrukta kalÄ±r; nedeni taslaÄŸa yazÄ±lmaz,
 *  Ã§alÄ±ÅŸtÄ±rma yanÄ±tÄ±nda dÃ¶ner.
 */
import { checkEligibility, type BlockReason } from './outreach.ts'

export interface SendQueue {
  settings: { auto_send: boolean; gmail_verified_at: string | null; legal_confirmed_at: string | null; daily_limit: number }
  sent_today: number
  drafts: {
    id: string; subject: string; body: string; opportunity_id: string; company_id: string | null; sector: 'kamu' | 'ozel' | 'bilinmiyor'; has_evidence: boolean
    company: { website: string | null; excluded: boolean | null; opted_out: boolean | null } | null
    contact: { email: string; kind: string; verified_at: string; source_url: string } | null
    last_email_days: number | null; suppressed: boolean
  }[]
}

export interface OutreachDeps {
  queue: SendQueue
  killSwitchOpen: boolean
  send: (to: string, subject: string, body: string) => Promise<{ id: string }>
  record: (r: { draft_id: string; opportunity_id: string; company_id: string | null; recipient: string; gmail_message_id: string | null; status: 'gonderildi' | 'hata'; error: string | null }) => Promise<void>
  now: () => Date
}

export async function processSendQueue(d: OutreachDeps): Promise<{ sent: number; failed: number; held: { id: string; reasons: (BlockReason | 'acil_durdurma')[] }[] }> {
  const out = { sent: 0, failed: 0, held: [] as { id: string; reasons: (BlockReason | 'acil_durdurma')[] }[] }
  let today = d.queue.sent_today
  for (const x of d.queue.drafts) {
    const el = checkEligibility({
      autoSendEnabled: d.queue.settings.auto_send, gmailVerifiedAt: d.queue.settings.gmail_verified_at, legalConfirmedAt: d.queue.settings.legal_confirmed_at,
      recipient: x.contact ? { email: x.contact.email, kind: x.contact.kind, verifiedAt: x.contact.verified_at, sourceUrl: x.contact.source_url } : null,
      companyWebsite: x.company?.website ?? null, suppressed: x.suppressed, sentToday: today, dailyLimit: d.queue.settings.daily_limit,
      lastEmailDays: x.last_email_days, hasEvidence: x.has_evidence, sector: x.sector, companyExcluded: !!(x.company?.excluded || x.company?.opted_out), approved: true, now: d.now(),
    })
    const reasons: (BlockReason | 'acil_durdurma')[] = [...el.reasons, ...(d.killSwitchOpen ? [] : ['acil_durdurma' as const])]
    if (reasons.length) {
      out.held.push({ id: x.id, reasons })
      continue
    }
    try {
      const r = await d.send(x.contact!.email, x.subject, x.body)
      await d.record({ draft_id: x.id, opportunity_id: x.opportunity_id, company_id: x.company_id, recipient: x.contact!.email, gmail_message_id: r.id, status: 'gonderildi', error: null })
      out.sent++
      today++
    } catch (e) {
      await d.record({ draft_id: x.id, opportunity_id: x.opportunity_id, company_id: x.company_id, recipient: x.contact!.email, gmail_message_id: null, status: 'hata', error: (e instanceof Error ? e.message : String(e)).slice(0, 300) })
      out.failed++
    }
  }
  return out
}
