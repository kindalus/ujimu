<script setup lang="ts">
withDefaults(defineProps<{
  name: string
  size?: number | string
}>(), {
  size: 18
})
</script>

<template>
  <svg
    class="iconify ujimu-icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <g v-if="name === 'menu'">
      <line x1="4" y1="7" x2="20" y2="7" />
      <line x1="4" y1="12" x2="20" y2="12" />
      <line x1="4" y1="17" x2="14" y2="17" />
    </g>
    <g v-else-if="name === 'send'">
      <path d="M5 12 L20 5 L14 20 L11.5 13.5 L5 12 Z" />
    </g>
    <g v-else-if="name === 'plus'">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </g>
    <g v-else-if="name === 'chevDown'">
      <polyline points="6 9 12 15 18 9" />
    </g>
    <g v-else-if="name === 'chevUp'">
      <polyline points="6 15 12 9 18 15" />
    </g>
    <g v-else-if="name === 'copy'">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15 V6 a2 2 0 0 1 2 -2 h9" />
    </g>
    <g v-else-if="name === 'chevLeft'">
      <polyline points="14 6 8 12 14 18" />
    </g>
    <g v-else-if="name === 'close'">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </g>
    <g v-else-if="name === 'doc'">
      <path d="M7 3 H14 L19 8 V21 H7 Z" />
      <polyline points="14 3 14 8 19 8" />
    </g>
    <g v-else-if="name === 'trash'">
      <path d="M5 7 H19" />
      <path d="M9 7 V5 H15 V7" />
      <path d="M7 7 L8 20 H16 L17 7" />
    </g>
    <g v-else-if="name === 'edit'">
      <path d="M14 5 L19 10 L9 20 H4 V15 Z" />
    </g>
    <g v-else-if="name === 'user'">
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M4.5 20 C5.5 16 8.5 14.5 12 14.5 C15.5 14.5 18.5 16 19.5 20" />
    </g>
    <g v-else-if="name === 'spark'">
      <path d="M12 4 L13.8 10.2 L20 12 L13.8 13.8 L12 20 L10.2 13.8 L4 12 L10.2 10.2 Z" />
    </g>
    <g v-else-if="name === 'mail'">
      <rect x="4" y="6" width="16" height="13" rx="2" />
      <polyline points="4 8 12 14 20 8" />
    </g>
    <g v-else-if="name === 'phone'">
      <rect x="8" y="3" width="8" height="18" rx="2" />
      <line x1="11" y1="18" x2="13" y2="18" />
    </g>
    <g v-else-if="name === 'star'">
      <path d="M12 4 L14.2 9.4 L20 9.8 L15.6 13.6 L17 19.3 L12 16.2 L7 19.3 L8.4 13.6 L4 9.8 L9.8 9.4 Z" />
    </g>
    <g v-else-if="name === 'check'">
      <polyline points="5 13 10 18 19 7" />
    </g>
    <g v-else-if="name === 'refresh'">
      <path d="M19 12 a7 7 0 1 1 -2 -4.9" />
      <polyline points="19.5 3.5 19.5 8 15 8" />
    </g>
    <g v-else-if="name === 'upload'">
      <line x1="12" y1="15" x2="12" y2="4.5" />
      <polyline points="7.5 8.5 12 4 16.5 8.5" />
      <line x1="5" y1="19.5" x2="19" y2="19.5" />
    </g>
    <g v-else-if="name === 'pause'">
      <line x1="9.5" y1="5" x2="9.5" y2="19" />
      <line x1="14.5" y1="5" x2="14.5" y2="19" />
    </g>
    <g v-else-if="name === 'info'">
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="11" x2="12" y2="16" />
      <circle cx="12" cy="8" r="0.5" fill="currentColor" />
    </g>
    <g v-else-if="name === 'chat'">
      <path d="M5 6.5 H19 V16 H10 L6 20 V16 H5 Z" />
    </g>
    <g v-else-if="name === 'building'">
      <path d="M6 21 V5 H14 V21" />
      <path d="M14 9 H19 V21" />
      <line x1="9" y1="8" x2="11" y2="8" />
      <line x1="9" y1="12" x2="11" y2="12" />
      <line x1="9" y1="16" x2="11" y2="16" />
    </g>
    <g v-else-if="name === 'lock'">
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10 V7.5 a4 4 0 0 1 8 0 V10" />
    </g>
    <g v-else-if="name === 'pin'">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <line x1="10" y1="4" x2="10" y2="20" />
    </g>
    <g v-else-if="name === 'unpin'">
      <rect x="5" y="4" width="14" height="16" rx="2" />
      <line x1="10" y1="4" x2="10" y2="20" />
      <line x1="13" y1="9" x2="16" y2="12" />
      <line x1="16" y1="12" x2="13" y2="15" />
    </g>
    <g v-else>
      <circle cx="12" cy="12" r="9" />
    </g>
  </svg>
</template>
