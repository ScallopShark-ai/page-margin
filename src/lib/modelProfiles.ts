import type { ModelConfig, ProviderId } from '../types';
import { PROVIDERS } from './config';

const STORAGE_KEY = 'pagemargin.modelProfiles.v1';

export interface SavedModelProfile {
  id: string;
  name: string;
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  createdAt: number;
  updatedAt: number;
}

function newProfileId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `model-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizeBase(value: string): string {
  return value.trim().replace(/\/+$/, '');
}

function isProvider(value: unknown): value is ProviderId {
  return typeof value === 'string' && value in PROVIDERS;
}

function parseProfile(value: unknown): SavedModelProfile | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Partial<SavedModelProfile>;
  if (!isProvider(row.provider)) return null;
  const model = String(row.model ?? '').trim();
  const baseUrl = String(row.baseUrl ?? '').trim();
  if (!model || !baseUrl) return null;
  const now = Date.now();
  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? `${PROVIDERS[row.provider].label} · ${model}`),
    provider: row.provider,
    apiKey: typeof row.apiKey === 'string' ? row.apiKey : '',
    baseUrl,
    model,
    createdAt: Number(row.createdAt) || now,
    updatedAt: Number(row.updatedAt) || now,
  };
}

export function loadSavedModels(): SavedModelProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<string>();
    const profiles: SavedModelProfile[] = [];
    for (const item of parsed) {
      const profile = parseProfile(item);
      if (!profile) continue;
      const key = `${profile.provider}|${normalizeBase(profile.baseUrl)}|${profile.model}`;
      if (seen.has(key)) continue;
      seen.add(key);
      profiles.push({ ...profile, id: profile.id || newProfileId() });
    }
    return profiles.sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export function persistSavedModels(profiles: SavedModelProfile[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  } catch {
    // Storage can be disabled; the in-memory list still works for this tab.
  }
}

export function upsertSavedModel(
  profiles: SavedModelProfile[],
  config: ModelConfig,
): SavedModelProfile[] {
  const provider = config.provider;
  const model = config.model.trim();
  const baseUrl = normalizeBase(config.baseUrl) || PROVIDERS[provider].baseUrl;
  if (!model || !baseUrl) return profiles;
  const now = Date.now();
  const existing = profiles.find(
    (profile) =>
      profile.provider === provider &&
      normalizeBase(profile.baseUrl) === baseUrl &&
      profile.model === model,
  );
  const nextProfile: SavedModelProfile = existing
    ? {
        ...existing,
        name: `${PROVIDERS[provider].label} · ${model}`,
        apiKey: config.apiKey.trim(),
        baseUrl,
        model,
        updatedAt: now,
      }
    : {
        id: newProfileId(),
        name: `${PROVIDERS[provider].label} · ${model}`,
        provider,
        apiKey: config.apiKey.trim(),
        baseUrl,
        model,
        createdAt: now,
        updatedAt: now,
      };
  const next = existing
    ? profiles.map((profile) => (profile.id === existing.id ? nextProfile : profile))
    : [nextProfile, ...profiles];
  const sorted = next.sort((a, b) => b.updatedAt - a.updatedAt);
  persistSavedModels(sorted);
  return sorted;
}

export function removeSavedModel(
  profiles: SavedModelProfile[],
  id: string,
): SavedModelProfile[] {
  const next = profiles.filter((profile) => profile.id !== id);
  persistSavedModels(next);
  return next;
}

export function profileToConfig(
  profile: SavedModelProfile,
  remember: boolean,
): ModelConfig {
  return {
    provider: profile.provider,
    apiKey: profile.apiKey,
    baseUrl: profile.baseUrl,
    model: profile.model,
    remember,
  };
}
