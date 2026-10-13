/**
 * Realtime abonelik yaşam döngüsü: bağlanma, kopma durumunda kademeli yeniden
 * bağlanma, yeniden bağlanınca tam veri yenileme ve oturum kapanınca temizlik.
 *
 * Supabase istemcisinden bağımsız küçük bir arayüzle çalışır; böylece sahte
 * kanal ile birim testi yapılabilir (src/lib/realtimeSync.test.ts).
 */
export type SyncState = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline'

export interface ChangePayload {
  table: string
  eventType: 'INSERT' | 'UPDATE' | 'DELETE'
  new: Record<string, unknown>
  old: Record<string, unknown>
}

export interface ChannelLike {
  on(type: 'postgres_changes', filter: { event: '*'; schema: string; table: string }, cb: (payload: ChangePayload) => void): ChannelLike
  subscribe(cb: (status: string, err?: Error) => void): ChannelLike
}

export interface RealtimeClientLike {
  channel(name: string): ChannelLike
  removeChannel(channel: ChannelLike): unknown
}

export interface RealtimeSyncOptions {
  tables: readonly string[]
  /** Kanal adı öneki; kanal adları gizli veri içermez */
  channelPrefix?: string
  onChange: (payload: ChangePayload) => void
  /** Bağlantı (yeniden) kurulduğunda: kaçırılmış olası değişiklikler için tam yenileme */
  onResync: () => void
  onState?: (state: SyncState) => void
  backoffMs?: readonly number[]
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

const DEFAULT_BACKOFF = [1_000, 2_000, 5_000, 10_000, 30_000] as const

export class RealtimeSync {
  private channel: ChannelLike | null = null
  private timer: unknown = null
  private attempt = 0
  private seq = 0
  private stopped = true
  private _state: SyncState = 'idle'
  private readonly opts: Required<Omit<RealtimeSyncOptions, 'onState'>> & Pick<RealtimeSyncOptions, 'onState'>

  constructor(
    private readonly client: RealtimeClientLike,
    options: RealtimeSyncOptions,
  ) {
    this.opts = {
      channelPrefix: 'leonx-sync',
      backoffMs: DEFAULT_BACKOFF,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...options,
    }
  }

  get state(): SyncState {
    return this._state
  }

  /** Test ve tanılama için: şu ana kadar açılmış kanal sayısı */
  get channelsOpened(): number {
    return this.seq
  }

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempt = 0
    this.connect('connecting')
  }

  /** Oturum kapanınca: kanal kaldırılır, zamanlayıcı iptal edilir, olay dinleme biter. */
  stop(): void {
    this.stopped = true
    this.cancelTimer()
    this.teardown()
    this.setState('idle')
  }

  /** Uygulama ön plana geldiğinde veya ağ geri geldiğinde */
  resume(): void {
    if (this.stopped) return
    if (this._state === 'live') {
      this.opts.onResync()
      return
    }
    this.cancelTimer()
    this.attempt = 0
    this.connect('reconnecting')
  }

  /** Tarayıcı çevrimdışı olduğunu bildirdiğinde */
  markOffline(): void {
    if (this.stopped) return
    this.cancelTimer()
    this.teardown()
    this.setState('offline')
  }

  private connect(state: SyncState): void {
    this.teardown()
    this.setState(state)
    const name = `${this.opts.channelPrefix}-${++this.seq}`
    let ch = this.client.channel(name)
    for (const table of this.opts.tables) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => {
        if (this.channel === ch && !this.stopped) this.opts.onChange({ ...payload, table })
      })
    }
    this.channel = ch
    ch.subscribe((status) => {
      // Eski (kaldırılmış) kanallardan gelen durum bildirimleri yok sayılır
      if (this.channel !== ch || this.stopped) return
      if (status === 'SUBSCRIBED') {
        this.attempt = 0
        this.setState('live')
        this.opts.onResync()
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        this.scheduleReconnect()
      }
    })
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.timer !== null) return
    this.teardown()
    this.setState('reconnecting')
    const list = this.opts.backoffMs
    const delay = list[Math.min(this.attempt, list.length - 1)]
    this.attempt++
    this.timer = this.opts.setTimer(() => {
      this.timer = null
      if (!this.stopped) this.connect('reconnecting')
    }, delay)
  }

  private teardown(): void {
    const ch = this.channel
    this.channel = null
    if (ch) {
      try {
        void this.client.removeChannel(ch)
      } catch {
        /* kanal zaten kapalı */
      }
    }
  }

  private cancelTimer(): void {
    if (this.timer !== null) {
      this.opts.clearTimer(this.timer)
      this.timer = null
    }
  }

  private setState(s: SyncState): void {
    if (this._state === s) return
    this._state = s
    this.opts.onState?.(s)
  }
}
