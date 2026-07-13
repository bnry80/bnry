import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Force a single copy of React / three across fiber + drei + postprocessing.
  // Hard aliases prevent Vite's dep pre-bundling from duplicating React, which
  // otherwise triggers "Invalid hook call" inside the R3F reconciler.
  resolve: {
    dedupe: ['react', 'react-dom', 'three', '@react-three/fiber'],
    alias: {
      react: fileURLToPath(new URL('./node_modules/react', import.meta.url)),
      'react-dom': fileURLToPath(new URL('./node_modules/react-dom', import.meta.url)),
      three: fileURLToPath(new URL('./node_modules/three', import.meta.url)),
    },
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react/jsx-runtime',
      'three',
      '@react-three/fiber',
      '@react-three/drei',
    ],
  },
})
