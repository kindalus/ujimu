import { defineNuxtConfig } from 'nuxt/config'

export default defineNuxtConfig({
  compatibilityDate: '2026-05-15',
  modules: ['@nuxt/ui'],
  css: ['~/assets/css/main.css'],
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
