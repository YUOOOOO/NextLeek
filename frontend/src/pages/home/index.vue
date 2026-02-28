<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import StockPage from './stock/index.vue'
import FundPage from './fund/index.vue'
import GoldPage from './gold/index.vue'

const route = useRoute()
const type = computed(() => route.params.type as string)

const pages: Record<string, any> = { stock: StockPage, fund: FundPage, gold: GoldPage }
const currentPage = computed(() => pages[type.value] || StockPage)
</script>

<template>
  <component :is="currentPage" />
</template>
