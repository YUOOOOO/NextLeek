import { createRouter, createWebHistory } from 'vue-router'
import RotationPage from './pages/rotation/index.vue'
import FactorsPage from './pages/factors/index.vue'
import StockPickPage from './pages/stock-pick/index.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/rotation' },
    { path: '/rotation', name: 'rotation', component: RotationPage },
    { path: '/stock-pick', name: 'stock-pick', component: StockPickPage },
    { path: '/factors', name: 'factors', component: FactorsPage },
  ],
})

export default router
