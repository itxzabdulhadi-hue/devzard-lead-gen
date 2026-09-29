/**
 * Discovery provider interface.
 *
 * A provider turns a set of high-level filters into `DiscoveryRecord`s from a
 * legitimate, publicly available data source. New providers (e.g. OpenStreet
 * derived datasets with permissive terms) can be added by implementing this
 * interface and registering it in index.ts.
 */

export interface DiscoveryFilters {
  country?: string | null;
  region?: string | null;
  city?: string | null;
  category?: string | null;
  keyword?: string | null;
  limit: number;
}

export interface DiscoveryRecord {
  sourceId: string;
  name: string;
  category: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  socials: string[];
  confidence: number | null;
  operatingStatus: string | null;
}

export interface DiscoveryResult {
  records: DiscoveryRecord[];
  /** Total matching records if cheaply computable, else null. */
  totalAvailable: number | null;
}

export interface DataSourceTestResult {
  ok: boolean;
  detail: string;
  testedAt: string;
}

export interface DiscoveryProvider {
  id: string;
  label: string;
  type: 'dataset' | 'local-fixture';
  description: string;
  license: string;
  /** Whether the provider is usable with the current configuration. */
  isConfigured(): boolean;
  /** True when reaching the source requires internet (shown in the UI). */
  requiresInternet: boolean;
  search(filters: DiscoveryFilters): Promise<DiscoveryResult>;
  testConnection(): Promise<DataSourceTestResult>;
}
