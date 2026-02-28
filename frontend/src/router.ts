import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', component: () => import('./pages/landing/index.vue') },
    { path: '/home/:type', component: () => import('./pages/home/index.vue') },
  ],
})

export default router
