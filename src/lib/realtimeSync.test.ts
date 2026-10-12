import { describe, expect, it, vi } from 'vitest'
import { type ChangePayload, type ChannelLike, RealtimeSync, type SyncState } from './realtimeSync'

class FakeChannel implements ChannelLike {
  handlers = new Map<string, (p: ChangePayload) => void>()
  statusCb: ((s: string) => void) | null = null
  removed = false
  constructor(public name: string) {}
  on(_t: 'postgres_changes', f: { table: string }, cb: (p: ChangePayload) => void) {
    this.handlers.set(f.table, cb)
    return this
  }
  subscribe(cb: (s: string) => void) {
    this.statusCb = cb
    return this
  }
  emit(status: string) {
    this.statusCb?.(status)
  }
}

function setup() {
  const channels: FakeChannel[] = []
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = []
  const client = {
    channel: (name: string) => {
      const c = new FakeChannel(name)
      channels.push(c)
      return c
    },
    removeChannel: (c: ChannelLike) => {
      ;(c as FakeChannel).removed = true
    },
  }
  const states: SyncState[] = []
  const onChange = vi.fn()
  const onResync = vi.fn()
  const sync = new RealtimeSync(client, {
    tables: ['companies', 'projects'],
    onChange,
    onResync,
    onState: (s) => states.push(s),
    backoffMs: [100, 200, 400],
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false }
      timers.push(t)
      return t
    },
    clearTimer: (h) => {
      ;(h as { cancelled: boolean }).cancelled = true
    },
  })
  const runTimers = () => {
    for (const t of timers.splice(0)) if (!t.cancelled) t.fn()
  }
  return { sync, channels, timers, states, onChange, onResync, runTimers }
}

describe('RealtimeSync', () => {
  it('tüm tablolara abone olur, bağlanınca tam yenileme ister', () => {
    const { sync, channels, onResync, states } = setup()
    sync.start()
    expect(channels).toHaveLength(1)
    expect([...channels[0].handlers.keys()]).toEqual(['companies', 'projects'])
    channels[0].emit('SUBSCRIBED')
    expect(sync.state).toBe('live')
    expect(onResync).toHaveBeenCalledTimes(1)
    expect(states).toEqual(['connecting', 'live'])
  })

  it('değişiklikleri tablo adıyla iletir', () => {
    const { sync, channels, onChange } = setup()
    sync.start()
    channels[0].emit('SUBSCRIBED')
    channels[0].handlers.get('projects')!({ table: '', eventType: 'UPDATE', new: { id: '1' }, old: {} })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ table: 'projects', eventType: 'UPDATE' }))
  })

  it('bağlantı koparsa kademeli bekleyip yeni kanal açar ve yeniden yeniler', () => {
    const { sync, channels, timers, onResync, runTimers } = setup()
    sync.start()
    channels[0].emit('SUBSCRIBED')
    channels[0].emit('CHANNEL_ERROR')
    expect(sync.state).toBe('reconnecting')
    expect(channels[0].removed).toBe(true)
    expect(timers.map((t) => t.ms)).toEqual([100])
    runTimers()
    expect(channels).toHaveLength(2)
    channels[1].emit('TIMED_OUT')
    expect(timers.map((t) => t.ms)).toEqual([200])
    runTimers()
    channels[2].emit('SUBSCRIBED')
    expect(sync.state).toBe('live')
    expect(onResync).toHaveBeenCalledTimes(2)
    // Başarılı bağlantı sonrası bekleme süresi sıfırlanır
    channels[2].emit('CLOSED')
    expect(timers.map((t) => t.ms)).toEqual([100])
  })

  it('aynı kopma için birden fazla zamanlayıcı kurmaz', () => {
    const { sync, channels, timers } = setup()
    sync.start()
    channels[0].emit('CHANNEL_ERROR')
    channels[0].emit('CLOSED')
    expect(timers).toHaveLength(1)
  })

  it('kaldırılmış eski kanalın olaylarını yok sayar', () => {
    const { sync, channels, onChange, runTimers } = setup()
    sync.start()
    channels[0].emit('CHANNEL_ERROR')
    runTimers()
    channels[0].handlers.get('companies')!({ table: '', eventType: 'INSERT', new: {}, old: {} })
    channels[0].emit('SUBSCRIBED')
    expect(onChange).not.toHaveBeenCalled()
    expect(sync.state).toBe('reconnecting')
  })

  it('stop(): kanalı kaldırır, bekleyen yeniden bağlanmayı iptal eder, olay iletmez', () => {
    const { sync, channels, timers, onChange, runTimers } = setup()
    sync.start()
    channels[0].emit('SUBSCRIBED')
    channels[0].emit('CHANNEL_ERROR')
    sync.stop()
    expect(sync.state).toBe('idle')
    expect(timers[0].cancelled).toBe(true)
    runTimers()
    expect(channels).toHaveLength(1)
    channels[0].handlers.get('projects')!({ table: '', eventType: 'DELETE', new: {}, old: { id: '1' } })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('çevrimdışı → resume(): hemen yeniden bağlanır', () => {
    const { sync, channels } = setup()
    sync.start()
    channels[0].emit('SUBSCRIBED')
    sync.markOffline()
    expect(sync.state).toBe('offline')
    expect(channels[0].removed).toBe(true)
    sync.resume()
    expect(channels).toHaveLength(2)
    expect(sync.state).toBe('reconnecting')
  })

  it('canlıyken resume(): yalnızca veri yeniler (uygulama ön plana geldiğinde)', () => {
    const { sync, channels, onResync } = setup()
    sync.start()
    channels[0].emit('SUBSCRIBED')
    sync.resume()
    expect(onResync).toHaveBeenCalledTimes(2)
    expect(channels).toHaveLength(1)
  })
})
