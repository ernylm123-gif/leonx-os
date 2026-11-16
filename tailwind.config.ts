import tailwindcss from '@tailwindcss/vite'
import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '0 0% 100%',
        foreground: '222.2 84% 4.9%',
        card: {
          DEFAULT: '0 0% 100%',
          foreground: '222.2 84% 4.9%',
        },
        popover: {
          DEFAULT: '0 0% 100%',
          foreground: '222.2 84% 4.9%',
        },
        primary: {
          DEFAULT: '221.2 83.2% 53.3%',
          foreground: '210 40% 98%',
        },
        secondary: {
          DEFAULT: '210 40% 98%',
          foreground: '222.2 47.4% 15.3%',
        },
        muted: {
          DEFAULT: '210 40% 96.1%',
          foreground: '210 40% 35.1%',
        },
        accent: {
          ivory: '240 100% 98%',
          lavender: '260 80% 96%',
          rose: '330 70% 94%',
          sage: '120 40% 94%',
          champagne: '30 90% 96%',
        },
        border: '215 20% 65%',
        input: '215 20% 90%',
        ring: '221.2 83.2% 53.3%',
      },
      fontFamily: {
        display: ['"Source Sans 3"', 'sans-serif'],
        body: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-height)' },
          to: { height: '0' },
        },
        'caret-blink': {
          '0,70%,100%': { opacity: '1' },
          '20%,40%': { opacity: '0' },
        },
        'accordion-pop': {
          from: { scale: 0 },
          to: { scale: 1 },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'caret-blink': 'caret-blink 1.25s ease-out infinite',
        'accordion-pop': 'accordion-pop 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      },
    },
  },
  plugins: [tailwindcss()],
}

export default config