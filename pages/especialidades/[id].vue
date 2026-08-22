<script setup lang="ts">
import { createError, useFetch, useHead, useRoute, useRuntimeConfig, useSeoMeta } from 'nuxt/app'

interface PublicSpecialistSeo {
  title: string
  description: string
  introduction: string
  topics: string[]
  limitations: string
  call_to_action: string
}

interface PublicSpecialist {
  id: string
  name: string
  description: string
  seo: PublicSpecialistSeo
}

interface PublicSpecialistResponse {
  specialist: PublicSpecialist
}

const route = useRoute()
const runtimeConfig = useRuntimeConfig()
const specialistId = typeof route.params.id === 'string' ? route.params.id : ''
const endpointBase = '/api/public/specialists/'
const { data, error } = await useFetch<PublicSpecialistResponse>(`${endpointBase}${encodeURIComponent(specialistId)}`)

if (error.value || !data.value?.specialist) {
  throw createError({ statusCode: 404, statusMessage: 'Especialidade não encontrada' })
}

const specialist = data.value.specialist
const siteUrl = (typeof runtimeConfig.public.siteUrl === 'string'
  ? runtimeConfig.public.siteUrl
  : 'https://ujimu.com').replace(/\/$/, '')
const canonicalUrl = `${siteUrl}/especialidades/${specialist.id}`
const pageTitle = specialist.seo.title
const pageDescription = specialist.seo.description
const introduction = specialist.seo.introduction || specialist.description

useSeoMeta({
  title: pageTitle,
  description: pageDescription,
  robots: 'index, follow',
  ogType: 'website',
  ogLocale: 'pt_AO',
  ogSiteName: 'Ujimu',
  ogTitle: pageTitle,
  ogDescription: pageDescription,
  ogUrl: canonicalUrl,
  ogImage: `${siteUrl}/ujimu-social.png`,
  twitterCard: 'summary_large_image',
  twitterTitle: pageTitle,
  twitterDescription: pageDescription,
  twitterImage: `${siteUrl}/ujimu-social.png`
})

useHead({
  link: [{ rel: 'canonical', href: canonicalUrl }],
  script: [{
    type: 'application/ld+json',
    innerHTML: JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: pageTitle,
      description: pageDescription,
      url: canonicalUrl,
      inLanguage: 'pt-AO',
      isPartOf: { '@type': 'WebSite', name: 'Ujimu', url: `${siteUrl}/` }
    })
  }]
})
</script>

<template>
  <main class="specialist-public" :aria-labelledby="`specialist-${specialist.id}-title`">
    <NuxtLink class="specialist-back" to="/">← Todas as especialidades</NuxtLink>

    <header class="specialist-hero">
      <span class="specialist-kicker">Especialista Ujimu</span>
      <h1 :id="`specialist-${specialist.id}-title`">{{ specialist.seo.title }}</h1>
      <p>{{ introduction }}</p>
    </header>

    <section v-if="specialist.seo.topics.length" class="specialist-section" aria-labelledby="specialist-topics-title">
      <h2 id="specialist-topics-title">Temas abrangidos</h2>
      <ul class="specialist-topics">
        <li v-for="topic in specialist.seo.topics" :key="topic">{{ topic }}</li>
      </ul>
    </section>

    <section v-if="specialist.seo.limitations" class="specialist-section" aria-labelledby="specialist-limitations-title">
      <h2 id="specialist-limitations-title">Limites desta especialidade</h2>
      <p>{{ specialist.seo.limitations }}</p>
    </section>

    <section class="specialist-trust" aria-labelledby="specialist-trust-title">
      <h2 id="specialist-trust-title">Respostas apoiadas em fontes oficiais</h2>
      <p>O especialista consulta apenas a respectiva wiki e apresenta as fontes relevantes no fim de cada resposta.</p>
      <p>Conteúdo gerado por IA. Pode conter erros e não substitui aconselhamento profissional.</p>
    </section>

    <NuxtLink class="btn btn--primary specialist-cta" :to="{ path: '/', query: { specialist: specialist.id } }">
      {{ specialist.seo.call_to_action || 'Consultar este especialista' }}
    </NuxtLink>
  </main>
</template>

<style scoped>
.specialist-public { width: min(820px, 100%); margin: 0 auto; padding: 56px 24px 80px; }
.specialist-back { color: var(--muted); font-size: var(--fs-ui); text-decoration: none; }
.specialist-back:hover { color: var(--ink); }
.specialist-hero { padding: 64px 0 40px; border-bottom: 1px solid var(--line); }
.specialist-kicker { color: var(--yellow); font-size: var(--fs-micro); font-weight: 600; letter-spacing: .1em; text-transform: uppercase; }
.specialist-hero h1 { max-width: 760px; margin: 14px 0 18px; font-size: var(--fs-title); line-height: 1.05; letter-spacing: -.04em; }
.specialist-hero p, .specialist-section p, .specialist-trust p { color: var(--muted); font-size: var(--fs-read); line-height: 1.7; }
.specialist-section, .specialist-trust { padding: 36px 0; border-bottom: 1px solid var(--line); }
.specialist-section h2, .specialist-trust h2 { margin: 0 0 16px; font-size: var(--fs-read); }
.specialist-topics { display: flex; flex-wrap: wrap; gap: 10px; margin: 0; padding: 0; list-style: none; }
.specialist-topics li { border: 1px solid var(--line); border-radius: 999px; padding: 8px 13px; color: var(--ink); font-size: var(--fs-ui); }
.specialist-trust p { margin: 8px 0 0; }
.specialist-cta { display: inline-flex; margin-top: 36px; text-decoration: none; }
@media (max-width: 640px) { .specialist-public { padding-top: 32px; } .specialist-hero { padding-top: 44px; } }
</style>
