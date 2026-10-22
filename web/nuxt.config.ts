// OLIU web — the screens. Talks to the API through /api, proxied in development so cookies stay same-origin.
export default defineNuxtConfig({
  compatibilityDate: '2025-10-01',
  devtools: { enabled: false },
  ssr: true,
  css: ['~/assets/app.css'],
  app: {
    head: {
      title: 'OLIU',
      meta: [{ name: 'viewport', content: 'width=device-width, initial-scale=1' }],
      link: [{ rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap' }],
    },
  },
  routeRules: {
    '/api/**': { proxy: { to: `${process.env.API_URL ?? 'http://localhost:3001'}/api/**` } },
    '/dev/**': { proxy: { to: `${process.env.API_URL ?? 'http://localhost:3001'}/dev/**` } },
  },
  vite: { server: { fs: { allow: ['..'] } } },
});
