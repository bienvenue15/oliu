# web

Nuxt 3. The screens of the tenant portal. Calls the API through `/api/*` (proxied in development so the
session cookie stays same-origin). Never computes money, never decides who may see what: the sidebar,
the company list and the permissions all come from `GET /api/auth/me`.

```
npm run dev     http://localhost:3000
```

- `pages/login.vue`, `setup.vue`, `set-password.vue`, `forgot.vue` — public
- `pages/app/[screen].vue` — one route per mockup screen key; unbuilt screens say which slice brings them
- `components/Screen*.vue` — the built screens (slice 1: Users, Company, Audit)
- `composables/useSession.ts` — `me`, the company switcher, `useApi()` with the `X-Company` header
- `assets/app.css` — the mockup's tokens and components, reduced to what is used
- `server/routes/__dev/` — development-only helpers, refused in production
