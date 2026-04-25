import { fileURLToPath, URL } from "node:url"
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from "path"

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react({
      babel: {
        plugins: [['babel-plugin-react-compiler']],
      },
    }),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@usb-pd-sniffer/pd-core": fileURLToPath(
        new URL("../pd-core/src/index.ts", import.meta.url)
      ),
      "@usb-pd-sniffer/pd-monitor": fileURLToPath(
        new URL("../pd-monitor/src/index.ts", import.meta.url)
      ),
      "@usb-pd-sniffer/pd-monitor-atk-c2": fileURLToPath(
        new URL("../pd-monitor-atk-c2/src/index.ts", import.meta.url)
      ),
    },
  },
})
