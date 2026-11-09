export type Plan = {
  rpm: number;
  daily_tokens: number;
  max_tokens: number;
  tiers: string[];
  models: string[];
  billing: boolean;
};

export type ModelPrice = { in: number; out: number };

export type Me = {
  name: string;
  plan: string;
  billing: boolean;
  balance: number;
  limits: { rpm: number; daily_tokens: number; max_tokens: number };
  tokens_today: number;
  models: { id: string; price: ModelPrice }[];
  site: string;
};

export type ApiKeyRow = {
  id: number;
  prefix: string;
  label: string;
  created: number;
  last_used: number | null;
  current: boolean;
};

export type UsageRow = {
  key: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  cost: number;
};

export type Usage = { daily: UsageRow[]; models: UsageRow[] };

export type CreatedKey = { id: number; api_key: string };

export type AdminOverview = {
  plans: Record<string, Plan>;
  models: string[];
  queued: number;
  cache_entries: number | null;
  cache: { hit: number; miss: number };
  default_plan: string;
  backend: { db: string; state: string; degraded: boolean };
};

export type KeyState = 'ready' | 'cooldown' | 'disabled';

export type PoolKey = {
  provider: string;
  tier: 'free' | 'paid';
  key: string;
  state: KeyState;
  limited_models: Record<string, number>;
  inflight: number;
  ok: number;
  fail: number;
  last_error: string | null;
};

export type Breaker = { route: string; open: boolean; fails: number; latency_ms: Record<string, number> };

export type Pool = { keys: PoolKey[]; breakers: Breaker[] };

export type AdminUser = {
  id: number;
  name: string;
  plan: string;
  active: boolean;
  rpm: number | null;
  daily_tokens: number | null;
  ip_allow: string[];
  keys: number;
  tokens_today: number;
  balance: number;
};

export type NewUserBody = {
  name: string;
  plan: string;
  rpm: number | null;
  daily_tokens: number | null;
  ip_allow: string[];
};

export type UserPatchBody = {
  plan: string;
  rpm: number;
  daily_tokens: number;
  active: boolean;
  ip_allow: string[];
};

export type StatRow = {
  model: string;
  requests: number;
  prompt_tokens: number;
  completion_tokens: number;
  avg_latency_ms: number;
  errors: number;
  revenue: number;
  cache_hits: number;
};

export type ServiceHealth = 'operational' | 'degraded' | 'down';

export type PublicStatus = {
  site?: string;
  status: ServiceHealth;
  models: { id: string; status: ServiceHealth }[];
  updated: number;
  success_rate_15m: number | null;
};
