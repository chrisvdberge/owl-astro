import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const WEEK = 7 * 24 * 3600
const cors200 = { statuses: [200] } // only real (CORS) responses: opaque ones count several MB each against the storage quota

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt', // the app shows "new version — reload" instead of swapping code under a running session
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Owl Astro',
        short_name: 'Owl Astro',
        description: 'Astrophotography planner: sky framing, night schedule, catalogue and observation log',
        theme_color: '#0b0f17',
        background_color: '#0b0f17',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // the app, its icons and the catalogue are stored on install, so planning works with no signal
        globPatterns: ['**/*.{js,css,html,svg,png,ico,json,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          // forecast: fresh when online, the last one when not
          { urlPattern: /^https:\/\/api\.open-meteo\.com\//, handler: 'NetworkFirst', options: { cacheName: 'forecast', networkTimeoutSeconds: 6, expiration: { maxEntries: 20, maxAgeSeconds: 24 * 3600 }, cacheableResponse: cors200 } },
          // survey tiles for the places you looked at, so the sky view still shows them in the field
          { urlPattern: ({ url }) => /\/Norder\d+\//.test(url.pathname) || /\/properties$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'sky-tiles', expiration: { maxEntries: 1500, maxAgeSeconds: 30 * 24 * 3600 }, cacheableResponse: cors200 } },
          // framing previews, catalogue thumbnails and example images
          { urlPattern: ({ url }) => url.hostname.endsWith('hips-image-services') || url.pathname.includes('hips2fits') || url.hostname === 'upload.wikimedia.org', handler: 'StaleWhileRevalidate', options: { cacheName: 'images', expiration: { maxEntries: 400, maxAgeSeconds: 30 * 24 * 3600 }, cacheableResponse: cors200 } },
          { urlPattern: /^https:\/\/(en\.wikipedia|commons\.wikimedia)\.org\/w\/api\.php/, handler: 'StaleWhileRevalidate', options: { cacheName: 'wiki', expiration: { maxEntries: 200, maxAgeSeconds: WEEK }, cacheableResponse: cors200 } },
        ],
      },
    }),
  ],
})
