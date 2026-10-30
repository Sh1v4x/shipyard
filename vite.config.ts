import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const apiPort = Number(process.env.PORT ?? 4317)

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./web/src', import.meta.url)) } },
  server: {
    port: 5173,
    // L'API n'accepte que les origines connues : un autre port casserait les appels.
    strictPort: true,
    // Host d'origine conservé : l'API vérifie elle-même qu'il s'agit de l'interface locale.
    proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } },
  },
  build: { outDir: '../dist', emptyOutDir: true },
})
