import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: { input: resolve('src/host/index.ts'), output: { format: 'es', entryFileNames: 'index.js' } },
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
      rollupOptions: { input: { index: resolve('src/preload/index.ts'), 'plugin-sandbox': resolve('src/preload/plugin-sandbox.ts') }, external: ['electron'], output: { format: 'cjs', entryFileNames: '[name].cjs' } },
    },
  },
  renderer: {
    root: 'src/client', plugins: [vue()],
    build: { outDir: resolve('out/renderer'), rollupOptions: { input: resolve('src/client/index.html') } },
  },
})
