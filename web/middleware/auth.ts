/** Pages under /app need a session; the server already enforces this, the redirect is a courtesy. */
export default defineNuxtRouteMiddleware(async (to) => {
  if (!to.path.startsWith('/app')) return;
  const { me, load } = useSession();
  if (!me.value) await load();
  if (!me.value) return navigateTo('/login');
});
