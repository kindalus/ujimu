<script setup lang="ts">
import { useHead, useRuntimeConfig, useSeoMeta } from 'nuxt/app'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const isChatRoute = computed(() => route.path === '/')
const siteUrl = (typeof runtimeConfig.public.siteUrl === 'string'
  ? runtimeConfig.public.siteUrl
  : 'https://ujimu.com').replace(/\/$/, '')
const socialImagePath = '/ujimu-social.png'
const socialImageUrl = `${siteUrl}${socialImagePath}`
const canonicalUrl = computed(() => new URL(route.path, `${siteUrl}/`).toString())
const robots = computed(() => route.path === '/' ? 'index, follow' : 'noindex, nofollow')
const title = 'Ujimu — Consulte especialistas com fontes oficiais'
const description = 'Consulte especialistas de IA sobre legislação angolana. Receba respostas fundamentadas em fontes oficiais, com citações verificáveis.'

useSeoMeta({
  title,
  description,
  robots,
  ogType: 'website',
  ogLocale: 'pt_AO',
  ogSiteName: 'Ujimu',
  ogTitle: title,
  ogDescription: description,
  ogUrl: canonicalUrl,
  ogImage: socialImageUrl,
  ogImageAlt: 'Ujimu — Respostas fundamentadas. Fontes verificáveis.',
  ogImageWidth: 1200,
  ogImageHeight: 630,
  ogImageType: 'image/png',
  twitterCard: 'summary_large_image',
  twitterTitle: title,
  twitterDescription: description,
  twitterImage: socialImageUrl
})

useHead(() => ({
  htmlAttrs: { lang: 'pt-AO' },
  meta: [
    { name: 'theme-color', content: '#131310' }
  ],
  link: [
    { rel: 'canonical', href: canonicalUrl.value },
    { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
    { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
    { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
    { rel: 'manifest', href: '/site.webmanifest' }
  ],
  script: [
    {
      type: 'application/ld+json',
      innerHTML: JSON.stringify([
        { '@context': 'https://schema.org', '@type': 'WebSite', name: 'Ujimu', url: `${siteUrl}/`, inLanguage: 'pt-AO' },
        { '@context': 'https://schema.org', '@type': 'Organization', name: 'Ujimu', url: `${siteUrl}/` }
      ])
    }
  ]
}))
</script>

<template>
  <UApp>
    <NuxtPage v-if="isChatRoute" />
    <MockRouteChrome v-else>
      <NuxtPage />
    </MockRouteChrome>
  </UApp>
</template>
