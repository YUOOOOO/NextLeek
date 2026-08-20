import { createRouter, createWebHistory } from 'vue-router'
import RotationPage from './pages/rotation/index.vue'
import FactorsPage from './pages/factors/index.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/rotation' },
    { path: '/rotation', name: 'rotation', component: RotationPage },
    { path: '/factors', name: 'factors', component: FactorsPage },
  ],
})

export default router
