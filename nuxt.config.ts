import { defineNuxtConfig } from 'nuxt/config'
import type { ModuleOptions as NuxtFontsOptions } from '@nuxt/fonts'

const fonts: NuxtFontsOptions = {
  defaults: {
    weights: ['400 600'],
    styles: ['normal'],
    subsets: ['latin'],
    preload: false
  },
  families: [
    {
      name: 'Inter',
      src: '/fonts/inter-latin-400-600.woff2',
      weight: '400 600',
      style: 'normal',
      display: 'swap',
      fallbacks: ['Arial'],
      global: true,
      preload: true
    },
    {
      name: 'Literata',
      src: '/fonts/literata-latin-400-600.woff2',
      weight: '400 600',
      style: 'normal',
      display: 'swap',
      fallbacks: ['Georgia'],
      global: true,
      preload: false
    },
    {
      name: 'JetBrains Mono',
      src: '/fonts/jetbrains-mono-latin-400-600.woff2',
      weight: '400 600',
      style: 'normal',
      display: 'swap',
      fallbacks: ['Courier New'],
      global: true,
      preload: false
    }
  ]
}

export default defineNuxtConfig({
  compatibilityDate: '2026-05-15',
  modules: ['@nuxt/ui', ['@nuxt/fonts', fonts]],
  css: ['~/assets/css/main.css', '~/assets/css/typography.css'],
  runtimeConfig: {
    ujimuDataDir: process.env.UJIMU_DATA_DIR ?? '~/.local/share/ujimu',
    ujimuDbPath: process.env.UJIMU_DB_PATH,
    public: {
      appName: process.env.NUXT_PUBLIC_APP_NAME ?? 'Ujimu',
      siteUrl: process.env.NUXT_PUBLIC_SITE_URL ?? 'https://ujimu.com'
    }
  },
  typescript: {
    strict: true
  }
})
