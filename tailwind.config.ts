import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cmg: {
          primary: '#005faa',
          azure: '#0078d4',
          surface: '#f9f9ff',
          panel: '#ffffff',
          soft: '#f1f3ff',
          line: '#c0c7d4',
          text: '#141b2b',
          muted: '#404752',
          success: '#107c10',
          warning: '#d97706',
          danger: '#ba1a1a',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
} satisfies Config;
