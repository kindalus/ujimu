<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'

interface AuthSessionResponse {
  authenticated: boolean
  user?: { id: string; displayContact: string }
}

interface AdminSessionResponse extends AuthSessionResponse {
  admin: boolean
}

const route = useRoute()
const authSession = ref<AuthSessionResponse>({ authenticated: false })
const adminAvailable = ref(false)
const authPanelOpen = ref(false)

const adminNavItems = [
  { label: 'Painel', to: '/admin' },
  { label: 'Especialidades', to: '/admin/specialists' },
  { label: 'Analytics', to: '/admin/analytics' },
  { label: 'Ops', to: '/admin/ops' }
]

const userInitial = computed(() => authSession.value.user?.displayContact?.slice(0, 1).toUpperCase() || 'U')
const isAdminRoute = computed(() => route.path === '/admin' || route.path.startsWith('/admin/'))

function adminNavItemActive(path: string): boolean {
  if (path === '/admin') return route.path === '/admin'
  return route.path === path || route.path.startsWith(`${path}/`)
}

onMounted(() => {
  void loadAuthSession()
})

async function loadAuthSession(): Promise<void> {
  try {
    const response = await fetch('/api/auth/session')
    authSession.value = response.ok ? ((await response.json()) as AuthSessionResponse) : { authenticated: false }
  } catch {
    authSession.value = { authenticated: false }
  }
  void loadAdminSession()
}

async function loadAdminSession(): Promise<void> {
  try {
    const response = await fetch('/api/admin/session')
    const session = response.ok ? ((await response.json()) as AdminSessionResponse) : { authenticated: false, admin: false }
    adminAvailable.value = Boolean(session.authenticated && session.admin)
  } catch {
    adminAvailable.value = false
  }
}

function handleAuthenticatedSession(session: AuthSessionResponse): void {
  authSession.value = session
  void loadAdminSession()
}

async function logout(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
  authSession.value = { authenticated: false }
  adminAvailable.value = false
  authPanelOpen.value = false
}
</script>

<template>
  <div class="app route-chrome" data-theme="dark" data-yellow="moderado">
    <header class="topbar">
      <div class="topbar-left">
        <AppDrawer
          :is-authenticated="authSession.authenticated"
          :admin-available="adminAvailable"
          :user-label="authSession.user?.displayContact"
          open-label="Abrir menu"
          @open-auth="authPanelOpen = true"
          @logout="logout"
        />
        <NuxtLink to="/" class="wordmark" aria-label="Ujimu">Ujimu<span class="wordmark-dot" /></NuxtLink>
      </div>
      <div class="topbar-right">
        <span class="quota-pill">0/{{ authSession.authenticated ? 20 : 5 }} hoje</span>
        <button v-if="!authSession.authenticated" class="btn btn--ghost" type="button" @click="authPanelOpen = true">Entrar</button>
        <span v-else class="avatar" :title="authSession.user?.displayContact">{{ userInitial }}</span>
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

    <AuthModal v-model:open="authPanelOpen" :auth-session="authSession" @authenticated="handleAuthenticatedSession" />
  </div>
</template>

<style scoped>
a.adm-nav-item { color: inherit; text-decoration: none; }
</style>
