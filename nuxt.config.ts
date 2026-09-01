import { resolve } from 'node:path'
import { defineNuxtConfig } from 'nuxt/config'
import type { ModuleOptions as NuxtFontsOptions } from '@nuxt/fonts'
import type {} from '@nuxt/nitro-server/augments'

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
      name: 'Source Sans 3',
      src: '/fonts/source-sans-3-latin-400-600.woff2',
      weight: '400 600',
      style: 'normal',
      display: 'swap',
      fallbacks: ['Arial'],
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
  nitro: {
    externals: {
      traceInclude: [
        resolve('node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/auth/oauth/openai-codex.js')
      ]
    }
  },
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
