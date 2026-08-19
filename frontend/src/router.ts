import { createRouter, createWebHistory } from 'vue-router'
import RotationPage from './pages/rotation/index.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/rotation' },
    { path: '/rotation', name: 'rotation', component: RotationPage },
  ],
})

export default router
