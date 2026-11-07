/**
 * The outbox: tips typed with no signal wait on the phone and go when a connection appears. Each carries the
 * `clientId` made when it was typed, so sending it twice can never save it twice (the API returns the first).
 * Kept in localStorage: it survives closing the browser, and nothing but this phone ever reads it.
 */
export interface QueuedTip {
  clientId: string;
  body: Record<string, unknown>;
  /** What the person sees in the list: "RWF 20,000 · Checkpoint passage · PCIU 932093 6". */
  label: string;
  queuedAt: string;
  /** Set when the API refused it (a rule, not the network): the person must look at it. */
  error?: string;
}

const KEY = 'oliu.tip.outbox';

export function useTipOutbox() {
  const items = useState<QueuedTip[]>('tipOutbox', () => []);
  const online = useState<boolean>('tipOnline', () => true);
  const syncing = useState<boolean>('tipSyncing', () => false);

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(items.value));
    } catch {
      /* private window or storage blocked: the outbox then lives only while the page is open */
    }
  }
  function load() {
    if (import.meta.server) return;
    try {
      items.value = JSON.parse(localStorage.getItem(KEY) ?? '[]') as QueuedTip[];
    } catch {
      items.value = [];
    }
    online.value = navigator.onLine;
    window.addEventListener('online', () => (online.value = true));
    window.addEventListener('offline', () => (online.value = false));
  }
  function add(q: QueuedTip) {
    items.value = [...items.value, q];
    persist();
  }
  function remove(clientId: string) {
    items.value = items.value.filter((q) => q.clientId !== clientId);
    persist();
  }

  /** A failed call with no HTTP status is the network, not the API: stop and wait for a connection. */
  const isNetworkFailure = (e: unknown) =>
    !(e as { status?: number; statusCode?: number }).status &&
    !(e as { statusCode?: number }).statusCode;

  /** Sends every waiting tip in order. Stops at the first network failure; keeps a refused tip with its reason. */
  async function sync(
    api: <T>(url: string, opts?: Record<string, unknown>) => Promise<T>,
  ): Promise<{ sent: number; left: number }> {
    if (syncing.value) return { sent: 0, left: items.value.length };
    syncing.value = true;
    let sent = 0;
    try {
      for (const q of [...items.value]) {
        try {
          await api('/api/tips', { method: 'POST', body: q.body });
          remove(q.clientId);
          sent++;
        } catch (e) {
          if (isNetworkFailure(e)) {
            online.value = false;
            break;
          }
          q.error = errorText(e);
          persist();
        }
      }
    } finally {
      syncing.value = false;
    }
    return { sent, left: items.value.length };
  }

  return { items, online, syncing, load, add, remove, sync, isNetworkFailure };
}
