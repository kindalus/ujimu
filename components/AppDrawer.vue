<script setup lang="ts">
import { computed, ref } from 'vue'

const props = withDefaults(defineProps<{
  isAuthenticated?: boolean
  adminAvailable?: boolean
  userLabel?: string
  openLabel?: string
}>(), {
  isAuthenticated: false,
  adminAvailable: false,
  userLabel: '',
  openLabel: 'Abrir navegação'
})

const emit = defineEmits<{
  openAuth: []
  logout: []
}>()

const drawerOpen = ref(false)
const drawerPinned = ref(false)
const pendingAuthOpen = ref(false)
const temporaryDrawerContent = ref<HTMLElement | null>(null)

const accountLabel = computed(() => props.userLabel || 'Conta')

function openDrawer(event?: MouseEvent): void {
  if (event?.currentTarget instanceof HTMLElement) {
    event.currentTarget.blur()
  }
  drawerOpen.value = true
  window.setTimeout(focusTemporaryDrawerStart, 0)
}

function focusTemporaryDrawerStart(): void {
  const firstInteractive = temporaryDrawerContent.value?.querySelector<HTMLElement>('a, button')
  firstInteractive?.focus()
}

function closeTemporaryDrawer(): void {
  if (!drawerPinned.value) {
    drawerOpen.value = false
  }
}

function openAuth(): void {
  if (drawerPinned.value) {
    emitOpenAuth()
    return
  }

  pendingAuthOpen.value = true
  drawerOpen.value = false

  window.setTimeout(() => {
    if (pendingAuthOpen.value) {
      pendingAuthOpen.value = false
      emitOpenAuth()
    }
  }, 250)
}

function handleDrawerAnimationEnd(open: boolean): void {
  if (!open && pendingAuthOpen.value) {
    pendingAuthOpen.value = false
    emitOpenAuth()
  }
}

function emitOpenAuth(): void {
  if (document.activeElement instanceof HTMLElement) {
    document.activeElement.blur()
  }
  emit('openAuth')
}

function logout(): void {
  closeTemporaryDrawer()
  emit('logout')
}
</script>

<template>
  <div class="app-drawer-shell" :class="{ pinned: drawerPinned }">
    <UButton
      type="button"
      color="neutral"
      variant="ghost"
      icon="i-lucide-menu"
      :aria-label="openLabel"
      aria-haspopup="dialog"
      :aria-expanded="drawerOpen"
      class="app-drawer-trigger"
      @click="openDrawer"
    >
      <span class="sr-only">{{ openLabel }}</span>
    </UButton>

    <UDrawer
      v-model:open="drawerOpen"
      direction="left"
      :handle="false"
      :ui="{
        content: 'bg-neutral-950/95 text-neutral-50 border-r border-white/10',
        body: 'p-0',
        footer: 'p-4 border-t border-white/10'
      }"
      @animation-end="handleDrawerAnimationEnd"
    >
      <template #body>
        <nav ref="temporaryDrawerContent" class="app-drawer-content" aria-label="Navegação principal">
          <div class="app-drawer-brand">
            <span class="app-drawer-logo" aria-hidden="true">U</span>
            <div>
              <strong>Ujimu</strong>
              <small>Consulta especializada</small>
            </div>
          </div>

          <UButton to="/" color="neutral" variant="ghost" icon="i-lucide-message-circle" block @click="closeTemporaryDrawer">
            Chat
          </UButton>

          <UButton to="/subscription" color="neutral" variant="ghost" icon="i-lucide-credit-card" block @click="closeTemporaryDrawer">
            Subscrição
          </UButton>

          <UButton
            v-if="adminAvailable"
            to="/admin"
            color="neutral"
            variant="ghost"
            icon="i-lucide-shield"
            block
            @click="closeTemporaryDrawer"
          >
            Administração
          </UButton>

          <UButton
            v-if="isAuthenticated"
            to="/account/security"
            color="neutral"
            variant="ghost"
            icon="i-lucide-lock-keyhole"
            block
            @click="closeTemporaryDrawer"
          >
            Segurança da conta
          </UButton>

          <UButton
            v-if="!isAuthenticated"
            type="button"
            color="primary"
            variant="soft"
            icon="i-lucide-log-in"
            block
            @click="openAuth"
          >
            Entrar
          </UButton>

          <slot name="history" :close="closeTemporaryDrawer" />
        </nav>
      </template>

      <template #footer>
        <div class="app-drawer-footer">
          <div v-if="isAuthenticated" class="app-drawer-account">
            <span>{{ accountLabel }}</span>
            <UButton type="button" color="neutral" variant="ghost" size="xs" @click="logout">
              Sair
            </UButton>
          </div>

          <UButton type="button" color="neutral" variant="soft" block @click="drawerPinned = !drawerPinned">
            {{ drawerPinned ? 'Desafixar' : 'Fixar' }}
          </UButton>
        </div>
      </template>
    </UDrawer>

    <aside v-if="drawerPinned" class="app-drawer-persistent" aria-label="Navegação principal fixa">
      <nav class="app-drawer-content">
        <div class="app-drawer-brand">
          <span class="app-drawer-logo" aria-hidden="true">U</span>
          <div>
            <strong>Ujimu</strong>
            <small>Consulta especializada</small>
          </div>
        </div>

        <UButton to="/" color="neutral" variant="ghost" icon="i-lucide-message-circle" block>
          Chat
        </UButton>
        <UButton to="/subscription" color="neutral" variant="ghost" icon="i-lucide-credit-card" block>
          Subscrição
        </UButton>
        <UButton v-if="adminAvailable" to="/admin" color="neutral" variant="ghost" icon="i-lucide-shield" block>
          Administração
        </UButton>
        <UButton
          v-if="isAuthenticated"
          to="/account/security"
          color="neutral"
          variant="ghost"
          icon="i-lucide-lock-keyhole"
          block
        >
          Segurança da conta
        </UButton>
        <UButton v-if="!isAuthenticated" type="button" color="primary" variant="soft" icon="i-lucide-log-in" block @click="openAuth">
          Entrar
        </UButton>
        <slot name="history" :close="closeTemporaryDrawer" />
        <UButton type="button" color="neutral" variant="soft" block @click="drawerPinned = false">
          Desafixar
        </UButton>
      </nav>
    </aside>
  </div>
</template>

<style scoped>
.app-drawer-shell {
  position: relative;
  z-index: 20;
}

.app-drawer-trigger {
  border-radius: 999px;
}

.app-drawer-content,
.app-drawer-footer {
  display: grid;
  gap: 12px;
  padding: 16px;
}

.app-drawer-brand,
.app-drawer-account {
  display: flex;
  gap: 12px;
  align-items: center;
}

.app-drawer-brand {
  padding-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
}

.app-drawer-brand strong,
.app-drawer-account span {
  color: #f7f6ef;
  font-weight: 800;
}

.app-drawer-brand small {
  display: block;
  margin-top: 2px;
  color: #b9b7ad;
}

.app-drawer-logo {
  display: grid;
  width: 38px;
  height: 38px;
  place-items: center;
  border-radius: 14px;
  color: #050505;
  background: var(--ujimu-yellow);
  font-weight: 900;
}

.app-drawer-account {
  justify-content: space-between;
}

.app-drawer-persistent {
  display: none;
}

@media (min-width: 1024px) {
  .app-drawer-persistent {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 30;
    display: block;
    width: min(360px, 28vw);
    border-right: 1px solid rgba(255, 255, 255, 0.12);
    background: rgba(8, 8, 8, 0.96);
    backdrop-filter: blur(18px);
  }
}
</style>
