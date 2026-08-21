<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

interface AuthSessionResponse {
  authenticated: boolean
  user?: { id: string; displayContact: string }
}

interface FeaturesResponse {
  otpChannels: Array<'email' | 'phone'>
  subscriptionsEnabled: boolean
  companiesEnabled: boolean
}

const route = useRoute()
const authSession = ref<AuthSessionResponse>({ authenticated: false })
const authPanelOpen = ref(false)
const otpChannels = ref<Array<'email' | 'phone'>>([])
const subscriptionsEnabled = ref(false)

const adminNavItems = [
  { label: 'Painel', to: '/admin' },
  { label: 'Especialidades', to: '/admin/specialists' },
  { label: 'Analytics', to: '/admin/analytics' },
  { label: 'Ops', to: '/admin/ops' }
]

const userInitial = computed(() => authSession.value.user?.displayContact?.slice(0, 1).toUpperCase() || 'U')
const accountLoginAvailable = computed(() => otpChannels.value.length > 0)
const isAdminRoute = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'))

function adminNavItemActive(path: string): boolean {
  if (path === '/admin') return route.path === '/admin'
  return route.path === path || route.path.startsWith(`${path}/`)
}

onMounted(() => {
  void loadAuthSession()
  void loadFeatures()
})

async function loadFeatures(): Promise<void> {
  try {
    const response = await fetch('/api/features')
    const payload = response.ok
      ? (await response.json()) as FeaturesResponse
      : { otpChannels: [], subscriptionsEnabled: false, companiesEnabled: false }
    otpChannels.value = payload.otpChannels.filter((channel) => channel === 'email' || channel === 'phone')
    subscriptionsEnabled.value = payload.subscriptionsEnabled === true
  } catch {
    otpChannels.value = []
    subscriptionsEnabled.value = false
  }
}

async function loadAuthSession(): Promise<void> {
  try {
    const response = await fetch('/api/auth/session')
    authSession.value = response.ok ? ((await response.json()) as AuthSessionResponse) : { authenticated: false }
  } catch {
    authSession.value = { authenticated: false }
  }
}

function handleAuthenticatedSession(session: AuthSessionResponse): void {
  authSession.value = session
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  authSession.value = { authenticated: false }
  authPanelOpen.value = false
}
</script>

<template>
  <div class="app route-chrome" data-theme="dark" data-yellow="moderado">
    <header class="topbar">
      <div class="topbar-left">
        <AppDrawer
          :is-authenticated="authSession.authenticated"
          :account-login-available="accountLoginAvailable"
          :subscriptions-enabled="subscriptionsEnabled"
          :user-label="authSession.user?.displayContact"
          open-label="Abrir menu"
          @open-auth="authPanelOpen = true"
          @logout="logout"
        />
        <NuxtLink to="/" class="wordmark" aria-label="Ujimu">Ujimu<span class="wordmark-dot" /></NuxtLink>
      </div>
      <div class="topbar-right">
        <span class="quota-pill">0/{{ authSession.authenticated ? 40 : 10 }} hoje</span>
        <button v-if="!authSession.authenticated && accountLoginAvailable" class="btn btn--ghost" type="button" @click="authPanelOpen = true">Entrar</button>
        <span v-else-if="authSession.authenticated" class="avatar" :title="authSession.user?.displayContact">{{ userInitial }}</span>
      </div>
    </header>

    <main v-if="isAdminRoute" class="stage">
      <div class="adm">
        <aside class="adm-nav" aria-label="Administração">
          <span class="adm-nav-label">/admin</span>
          <NuxtLink
            v-for="item in adminNavItems"
            :key="item.to"
            class="adm-nav-item"
            :class="{ 'adm-nav-item--on': adminNavItemActive(item.to) }"
            :to="item.to"
            :title="item.to"
          >
            {{ item.label }}
          </NuxtLink>
          <div class="adm-nav-spacer" />
          <NuxtLink class="adm-nav-item" to="/"><UjimuIcon name="chevLeft" /> Sair da administração</NuxtLink>
        </aside>
        <div class="adm-content">
          <slot />
        </div>
      </div>
    </main>

    <main v-else class="stage stage--page route-chrome-stage">
      <slot />
    </main>

    <LazyAuthModal v-if="authPanelOpen" v-model:open="authPanelOpen" :auth-session="authSession" @authenticated="handleAuthenticatedSession" />
  </div>
</template>

<style scoped>
a.adm-nav-item { color: inherit; text-decoration: none; }
</style>
