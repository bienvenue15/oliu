/**
 * The signed-in person, as the API describes them: role, companies, menus, permissions.
 * The web app never decides access itself; it only shows what /api/auth/me says.
 */
export interface Me {
  user: { id: string; name: string; email: string; role: string; roleLabel: string; companyId: string | null; otpMailbox: string };
  account: { id: string; name: string; package: 'SINGLE' | 'GROUP'; handoverStage: string | null; status: string };
  companies: { id: string; legalName: string; country: string; currency: string; kind: string; parentId: string | null; billsClient: boolean }[];
  activeCompanyId: string | null;
  permissions: string[];
  menus: { key: string; label: string; screens: { key: string; label: string; slice: number }[] }[];
  home: string;
}

export function useSession() {
  const me = useState<Me | null>('me', () => null);
  const activeCompany = useState<string | null>('activeCompany', () => null);

  async function load(): Promise<Me | null> {
    try {
      const headers = useRequestHeaders(['cookie']);
      const data = await $fetch<Me>('/api/auth/me', { headers, credentials: 'include' });
      me.value = data;
      if (!activeCompany.value) activeCompany.value = data.activeCompanyId ?? data.companies[0]?.id ?? null;
      return data;
    } catch {
      me.value = null;
      return null;
    }
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => undefined);
    me.value = null;
    await navigateTo('/login');
  }

  const can = (p: string) => !!me.value?.permissions.includes(p);
  const canOpen = (screen: string) => !!me.value?.menus.some((m) => m.screens.some((s) => s.key === screen));

  return { me, activeCompany, load, logout, can, canOpen };
}

/** $fetch with the cookie and the company switcher header attached. */
export function useApi() {
  const { activeCompany } = useSession();
  // During server-side rendering the browser's cookie must travel with the call to the API.
  const forwarded = import.meta.server ? useRequestHeaders(['cookie']) : {};
  return async <T>(url: string, opts: Parameters<typeof $fetch>[1] = {}): Promise<T> => {
    const headers: Record<string, string> = { ...forwarded, ...(opts.headers as Record<string, string> | undefined) };
    if (activeCompany.value) headers['X-Company'] = activeCompany.value;
    return $fetch<T>(url, { ...opts, headers, credentials: 'include' }) as Promise<T>;
  };
}

/** Error text from a failed $fetch, with the field list when the API sent one. */
export function errorText(e: unknown): string {
  const err = e as { data?: { error?: string; details?: { path: string; message: string }[] }; message?: string };
  const base = err.data?.error ?? err.message ?? 'Something went wrong';
  const fields = err.data?.details?.map((d) => `${d.path}: ${d.message}`).join(' · ');
  return fields ? `${base} — ${fields}` : base;
}
