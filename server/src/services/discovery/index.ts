/**
 * Provider registry. Additional legitimate data sources can be added here.
 */
import { overtureProvider } from './overture.js';
import { fixtureProvider } from './fixture.js';
import type { DiscoveryProvider } from './types.js';

export const providers: DiscoveryProvider[] = [fixtureProvider, overtureProvider];

export function getProvider(id: string): DiscoveryProvider | null {
  return providers.find((p) => p.id === id) ?? null;
}

/** Default provider: fixture when available (offline-first), else overture. */
export function defaultProviderId(): string {
  return fixtureProvider.isConfigured() ? 'fixture' : 'overture';
}

export type { DiscoveryProvider, DiscoveryFilters, DiscoveryRecord } from './types.js';
export { toIsoCountry } from './overture.js';
