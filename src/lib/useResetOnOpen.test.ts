import { createElement, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { useResetOnOpen } from './useResetOnOpen'

// DOM ortamı olmadan: sunucu render'ı, render sırasındaki state güncellemesini aynı geçişte uygular
function Probe({ open, onReset, initial }: { open: boolean; onReset: () => void; initial: string }) {
  const [value, setValue] = useState('eski')
  useResetOnOpen(open, () => {
    onReset()
    setValue(initial)
  })
  return createElement('span', null, value)
}

describe('useResetOnOpen', () => {
  it('açık render\'da sıfırlamayı aynı render içinde uygular (effect beklemeden)', () => {
    const onReset = vi.fn()
    const html = renderToStaticMarkup(createElement(Probe, { open: true, onReset, initial: 'yeni' }))
    expect(html).toBe('<span>yeni</span>')
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it('kapalıyken sıfırlamaz', () => {
    const onReset = vi.fn()
    const html = renderToStaticMarkup(createElement(Probe, { open: false, onReset, initial: 'yeni' }))
    expect(html).toBe('<span>eski</span>')
    expect(onReset).not.toHaveBeenCalled()
  })
})
