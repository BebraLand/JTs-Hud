import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        external: ['sqlite3', 'express', 'socket.io', 'csgogsi']
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        external: ['sqlite3', 'express', 'socket.io', 'csgogsi']
      }
    }
  },
  renderer: {
    server: {
      port: 5174
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [vue(), tailwindcss()]
  }
})
