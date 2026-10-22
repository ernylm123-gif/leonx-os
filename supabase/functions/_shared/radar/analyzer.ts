/**
 * LEONX Radar — çözümleyici arayüzü.
 *
 * Bu sürümde YALNIZ kural motoru vardır (ücretsiz, deterministik, açıklanabilir). İleride bir dil
 * modeli çözümleyicisi aynı arayüzle eklenebilir; ancak yalnız (1) özellik bayrağı açıkken,
 * (2) aylık bütçe kalmışken ve (3) sahip onayıyla seçilir. Dil modeli çağrısı bu depoda YOKTUR.
 * Her durumda kaynak metni veri olarak verilir; çıktı yine aynı Classification şemasına uymalı ve
 * "doğrulanmış ihtiyaç" kuralı (ilan + ürün adı) kural motorunca yeniden denetlenmelidir.
 */
import { type Classification, classify, type ClassifyInput } from './classify.ts'

export interface Analyzer {
  readonly id: string
  readonly kind: 'kural' | 'dil_modeli'
  analyze(input: ClassifyInput): Promise<Classification>
}

export const ruleAnalyzer: Analyzer = {
  id: 'kural-v1',
  kind: 'kural',
  analyze: (input) => Promise.resolve(classify(input)),
}

export interface AnalyzerFlags {
  /** Dil modeli çözümleyicisi özellik bayrağı (varsayılan kapalı) */
  llmEnabled: boolean
  /** Bu ay kalan bütçe (çağrı sayısı); 0 veya altı → kural motoru */
  budgetRemaining: number
}

/** Bayrak kapalı, bütçe yok veya çözümleyici verilmemişse daima kural motoru seçilir */
export function selectAnalyzer(flags: AnalyzerFlags, candidate?: Analyzer | null): Analyzer {
  if (!candidate || candidate.kind !== 'dil_modeli') return ruleAnalyzer
  if (!flags.llmEnabled || !(flags.budgetRemaining > 0)) return ruleAnalyzer
  return candidate
}
