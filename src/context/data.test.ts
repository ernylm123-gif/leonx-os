import { describe, expect, it } from 'vitest'
import { mergeServerList } from './data'

describe('mergeServerList', () => {
  it('yenileme sırasında gelen daha yeni yerel sürümü korur, silinenleri düşürür', () => {
    const server = [
      { id: 'a', version: 2, v: 'sunucu-a' },
      { id: 'b', version: 5, v: 'sunucu-b' },
    ]
    const local = [
      { id: 'a', version: 3, v: 'yerel-a' },
      { id: 'b', version: 4, v: 'yerel-b' },
      { id: 'c', version: 1, v: 'silinmis' },
    ]
    expect(mergeServerList(server, local).map((x) => x.v)).toEqual(['yerel-a', 'sunucu-b'])
  })
})
