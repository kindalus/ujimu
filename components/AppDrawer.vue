<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  isAuthenticated?: boolean
  accountLoginAvailable?: boolean
  subscriptionsEnabled?: boolean
  userLabel?: string
  openLabel?: string
}>(), {
  isAuthenticated: false,
  accountLoginAvailable: false,
  subscriptionsEnabled: false,
  userLabel: '',
  openLabel: 'Abrir menu'
})

const emit = defineEmits<{
  openAuth: []
  logout: []
  newConversation: []
}>()

const drawerOpen = ref(false)
const temporaryDrawerContent = ref<HTMLElement | null>(null)

function openDrawer(event?: MouseEvent): void {
  if (event?.currentTarget instanceof HTMLElement) event.currentTarget.blur()
  drawerOpen.value = true
  window.setTimeout(focusTemporaryDrawerStart, 0)
}

function focusTemporaryDrawerStart(): void {
  const firstInteractive = temporaryDrawerContent.value?.querySelector<HTMLElement>('a, button')
  firstInteractive?.focus()
}

function closeTemporaryDrawer(): void {
  if (document.activeElement instanceof HTMLElement && temporaryDrawerContent.value?.contains(document.activeElement)) {
    document.activeElement.blur()
  }
  drawerOpen.value = false
}

function openAuth(): void {
  closeTemporaryDrawer()
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
  emit('openAuth')
}

function startNewConversation(): void {
  closeTemporaryDrawer()
  emit('newConversation')
}

function logout(): void {
  closeTemporaryDrawer()
  emit('logout')
}
</script>

<template>
  <div class="app-drawer-shell">
    <button class="iconbtn app-drawer-trigger" type="button" :aria-label="openLabel" aria-haspopup="dialog" :aria-expanded="drawerOpen" @click="openDrawer">
      <UjimuIcon name="menu" />
      <span class="sr-only">{{ openLabel }}</span>
    </button>

    <div class="scrim" :class="{ 'scrim--on': drawerOpen }" @click="closeTemporaryDrawer" />

    <aside
      ref="temporaryDrawerContent"
      class="drawer"
      :class="{ 'drawer--open': drawerOpen }"
      :aria-hidden="!drawerOpen"
      :inert="!drawerOpen"
      @keydown.esc="closeTemporaryDrawer"
    >
      <div class="drawer-head">
        <span class="wordmark">Ujimu<span class="wordmark-dot" /></span>
        <button class="iconbtn" type="button" aria-label="Fechar menu" @click="closeTemporaryDrawer"><UjimuIcon name="close" /></button>
      </div>

      <NuxtLink class="btn btn--new" to="/" @click="startNewConversation"><UjimuIcon name="plus" /> Nova consulta</NuxtLink>

      <div class="drawer-scroll">
        <slot name="history" :close="closeTemporaryDrawer">
          <div v-if="!isAuthenticated" class="drawer-empty">
            <p>{{ accountLoginAvailable ? 'O histórico de conversas fica disponível depois de iniciar sessão.' : 'O histórico requer uma conta, temporariamente indisponível.' }}</p>
            <button v-if="accountLoginAvailable" class="btn btn--primary" type="button" @click="openAuth">Entrar por OTP</button>
          </div>
          <div v-else class="drawer-empty"><p>Ainda não tem conversas guardadas.</p></div>
        </slot>
      </div>

      <div class="drawer-foot">
        <NuxtLink v-if="isAuthenticated" class="drawer-foot-link" to="/account/profile" @click="closeTemporaryDrawer"><UjimuIcon name="user" /> O meu perfil</NuxtLink>
        <NuxtLink v-if="subscriptionsEnabled" class="drawer-foot-link" to="/subscription" @click="closeTemporaryDrawer"><UjimuIcon name="star" /> Subscrição</NuxtLink>
        <NuxtLink class="drawer-foot-link" to="/admin" @click="closeTemporaryDrawer"><UjimuIcon name="spark" /> Administração <span class="drawer-foot-tag">/admin</span></NuxtLink>
        <div v-if="isAuthenticated" class="drawer-user">
          <span class="avatar avatar--sm">{{ props.userLabel?.slice(0, 1).toUpperCase() || 'U' }}</span>
          <div class="drawer-user-meta">
            <span class="drawer-user-contact">{{ props.userLabel || 'Conta' }}</span>
            <button class="drawer-user-out" type="button" title="Terminar sessão" @click="logout">Terminar sessão</button>
          </div>
        </div>
        <button v-else-if="accountLoginAvailable" class="drawer-foot-link" type="button" @click="openAuth"><UjimuIcon name="user" /> Iniciar sessão</button>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.app-drawer-shell { display: inline-flex; }
.app-drawer-trigger { color: var(--ink); }
a.btn, a.drawer-foot-link { color: inherit; text-decoration: none; }
</style>
