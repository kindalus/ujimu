<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const isChatRoute = computed(() => route.path === '/')
</script>

<template>
  <UApp>
    <NuxtPage v-if="isChatRoute" />
    <MockRouteChrome v-else>
      <NuxtPage />
    </MockRouteChrome>
  </UApp>
</template>
