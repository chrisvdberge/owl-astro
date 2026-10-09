import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Generates the install icons (64/192/512, maskable, Apple touch, favicon.ico) from the owl logo: `npm run icons`
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#0b0f17', fit: 'contain' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#0b0f17', fit: 'contain' } },
  },
  images: ['public/favicon.svg'],
})
