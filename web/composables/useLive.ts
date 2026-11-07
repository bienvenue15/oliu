/**
 * Live updates. One EventSource per browser tab on /api/events; screens say which modules they show and get a
 * debounced call to refetch when a notice for one of them arrives. The browser reconnects by itself; the dot in
 * the top bar says whether the stream is open. Nothing is pushed but "something changed": every screen refetches
 * through the same scoped routes it already uses.
 */
export interface LiveNotice {
  module: string;
  action: string;
  entity: string;
  entityId: string | null;
  companyId: string | null;
  at: string;
}
type Handler = (n: LiveNotice) => void;

const handlers = new Set<{ modules: readonly string[] | '*'; handler: Handler }>();
let source: EventSource | null = null;

export function useLive() {
  const connected = useState<boolean>('liveConnected', () => false);
  const lastAt = useState<string>('liveLastAt', () => '');

  function connect() {
    if (import.meta.server || source) return;
    source = new EventSource('/api/events', { withCredentials: true });
    source.addEventListener('hello', () => (connected.value = true));
    source.addEventListener('change', (ev) => {
      const n = JSON.parse((ev as MessageEvent).data) as LiveNotice;
      lastAt.value = n.at;
      for (const h of handlers) if (h.modules === '*' || h.modules.includes(n.module)) h.handler(n);
    });
    source.onerror = () => (connected.value = false);
    source.onopen = () => (connected.value = true);
  }
  function disconnect() {
    source?.close();
    source = null;
    connected.value = false;
  }

  /**
   * Refetch when any of `modules` changes (audit module names: shipments, costs, journey, tips, accounts, identity;
   * '*' for everything). Calls are debounced, so a burst of writes means one refetch. Removed when the screen leaves.
   */
  function onChange(modules: readonly string[] | '*', refetch: () => unknown, debounceMs = 300) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const entry = {
      modules,
      handler: () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          timer = null;
          void refetch();
        }, debounceMs);
      },
    };
    // The company switcher is a change too, one the server never announces: the MD moving from OLIU to JIVAH
    // must see JIVAH's data at once (the owner, 30 Oct 2026).
    const { activeCompany } = useSession();
    watch(activeCompany, (now, before) => {
      if (before !== null && now !== before) entry.handler();
    });
    onMounted(() => {
      handlers.add(entry);
      connect();
    });
    onBeforeUnmount(() => {
      handlers.delete(entry);
      if (timer) clearTimeout(timer);
    });
  }

  return { connected, lastAt, connect, disconnect, onChange };
}
