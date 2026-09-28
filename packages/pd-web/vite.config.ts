import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  build: {
    target: 'chrome89',
  },
  // Resolves the "paths" from this package's tsconfig (notably "@/..." -> "./src/...")
  // without the vite-tsconfig-paths plugin. Vite 7.1+ does this natively.
  resolve: {
    tsconfigPaths: true,
  },
  optimizeDeps: {
    exclude: ['@sqlite.org/sqlite-wasm'],
  },
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
  ],
})
