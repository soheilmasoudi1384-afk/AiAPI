import { createSession } from './createSession';
import { request } from './api';
import type { AdminOverview, Me } from './types';

export const userSession = createSession<Me>({
  storageKey: 'gw_key',
  verify: (token) => request<Me>('/account/me', token),
});

export const adminSession = createSession<AdminOverview>({
  storageKey: 'gw_admin',
  verify: (token) => request<AdminOverview>('/admin/overview', token),
});

export const { SessionGate: UserGate, useSession: useUserSession } = userSession;
export const { SessionGate: AdminGate, useSession: useAdminSession } = adminSession;
