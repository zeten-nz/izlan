import type { Config } from 'tailwindcss';

/**
 * Class-based dark mode driven by the ThemeProvider (`<html class="dark">`). Colors are declared as CSS custom
 * properties (design tokens) in globals.css so a single token set drives both themes; Tailwind utilities read them
 * via `rgb(var(--token) / <alpha-value>)`. No hard-coded hex colors in components.
 */
const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'rgb(var(--color-bg) / <alpha-value>)',
        surface: 'rgb(var(--color-surface) / <alpha-value>)',
        'surface-2': 'rgb(var(--color-surface-2) / <alpha-value>)',
        border: 'rgb(var(--color-border) / <alpha-value>)',
        text: 'rgb(var(--color-text) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        'primary-fg': 'rgb(var(--color-primary-fg) / <alpha-value>)',
        'primary-600': 'rgb(var(--color-primary-600) / <alpha-value>)',
        'primary-tint': 'rgb(var(--color-primary-tint) / <alpha-value>)',
        danger: 'rgb(var(--color-danger) / <alpha-value>)',
        'danger-tint': 'rgb(var(--color-danger-tint) / <alpha-value>)',
        warning: 'rgb(var(--color-warning) / <alpha-value>)',
        success: 'rgb(var(--color-success) / <alpha-value>)',
        'success-tint': 'rgb(var(--color-success-tint) / <alpha-value>)',
        info: 'rgb(var(--color-info) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
      },
      borderRadius: {
        card: 'var(--radius-card)',
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
