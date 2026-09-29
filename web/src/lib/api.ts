/** Small typed API client — same-origin /api, cookie session. */

export interface ApiErrorShape {
  message: string;
  code?: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: ApiErrorShape,
  ) {
    super(body.message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'include',
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    window.dispatchEvent(new CustomEvent('devzard:unauthorized'));
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON (e.g. empty)
  }
  if (!res.ok) {
    const shape =
      body && typeof body === 'object' && 'error' in body
        ? ((body as { error: ApiErrorShape }).error)
        : { message: `Request failed (${res.status})` };
    throw new ApiError(res.status, shape);
  }
  return (body as { data: T }).data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/* ── Shared types mirroring the API responses ──────────────────────────── */

export type LeadStatus =
  | 'new'
  | 'reviewing'
  | 'qualified'
  | 'contacted'
  | 'interested'
  | 'meeting'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'rejected';

export const LEAD_STATUSES: LeadStatus[] = [
  'new',
  'reviewing',
  'qualified',
  'contacted',
  'interested',
  'meeting',
  'proposal',
  'won',
  'lost',
  'rejected',
];

export interface LeadRow {
  id: string;
  name: string;
  category: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  facebook: string | null;
  instagram: string | null;
  linkedin: string | null;
  source: string;
  sourceConfidence: number | null;
  operatingStatus: string | null;
  createdAt: string;
  leadId: string;
  leadStatus: LeadStatus;
  assignedTo: string | null;
  assignedToName: string | null;
  followUpAt: string | null;
  tags: string[];
  score: number | null;
  scoreCalculatedAt: string | null;
  analyzedAt: string | null;
  reachable: boolean | null;
  cms: string | null;
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface ScoreSignal {
  type: string;
  category: 'website' | 'presence' | 'fit' | 'data_quality';
  points: number;
  description: string;
}

export interface ScoreData {
  websiteScore: number;
  presenceScore: number;
  fitScore: number;
  dataQualityScore: number;
  totalScore: number;
  reasons: { signals: ScoreSignal[] };
  configVersion: string | null;
  calculatedAt: string;
}

export interface AnalysisData {
  reachable: boolean | null;
  https: boolean | null;
  responseStatus: number | null;
  responseMs: number | null;
  mobileFriendly: boolean | null;
  hasTitle: boolean | null;
  hasMetaDescription: boolean | null;
  hasH1: boolean | null;
  hasContactPage: boolean | null;
  hasContactInformation: boolean | null;
  hasWhatsapp: boolean | null;
  hasSocialLinks: boolean | null;
  hasCta: boolean | null;
  hasBooking: boolean | null;
  hasOrdering: boolean | null;
  ecommerceDetected: boolean | null;
  cms: string | null;
  robotsTxt: boolean | null;
  sitemap: boolean | null;
  canonical: boolean | null;
  structuredData: boolean | null;
  brokenLinksCount: number | null;
  error: string | null;
  analyzedAt: string;
}

export interface BusinessData {
  id: string;
  source: string;
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
  facebook: string | null;
  instagram: string | null;
  linkedin: string | null;
  operatingStatus: string | null;
  sourceConfidence: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadDetail {
  business: BusinessData;
  lead: {
    id: string;
    status: LeadStatus;
    assignedTo: string | null;
    notes: string | null;
    tags: string[];
    contactedAt: string | null;
    followUpAt: string | null;
    createdAt: string;
    updatedAt: string;
  };
  score: ScoreData | null;
  analysis: AnalysisData | null;
}

export interface AnalysisJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  total: number;
  completed: number;
  failed: number;
  error: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface DashboardStats {
  totals: { businesses: number; highOpportunity: number; analyzed: number; reachable: number };
  pipeline: Record<LeadStatus, number>;
  scoreBands: Array<{ band: string; count: number }>;
  topCategories: Array<{ category: string; count: number; avgScore: number }>;
  topCountries: Array<{ country: string; count: number; avgScore: number }>;
  topCities: Array<{ country: string; city: string; count: number; avgScore: number }>;
  recentLeads: Array<{
    id: string;
    name: string;
    category: string | null;
    city: string | null;
    country: string | null;
    website: string | null;
    score: number | null;
    status: LeadStatus;
    createdAt: string;
  }>;
}

export interface DiscoveryPreview {
  sourceId: string;
  name: string;
  category: string | null;
  country: string | null;
  city: string | null;
  website: string | null;
  phone: string | null;
  socials: string[];
  confidence: number | null;
}

export interface SearchResult {
  provider: { id: string; label: string; requiresInternet: boolean };
  discovered: number;
  importedPreviewCount: number;
  preview: DiscoveryPreview[];
}

export interface ImportResult {
  discovered: number;
  imported: number;
  alreadyExisting: number;
  duplicatesSkipped: number;
  invalidSkipped: number;
  businessIds: string[];
  analysisJobId: string | null;
  message: string;
}

export interface DataSourceInfo {
  id: string;
  label: string;
  type: string;
  description: string;
  license: string;
  requiresInternet: boolean;
  configured: boolean;
  config: { overtureUrl: string | null; fixturePath: string | null };
  lastTest: { ok: boolean; detail: string; testedAt: string } | null;
}

export interface ScoringConfig {
  version: string;
  categoryFit: Record<string, number>;
  categoryAliases: Record<string, string>;
  defaultFitKey: string;
  unknownCategoryFit: number;
  highConfidenceThreshold: number;
}

export interface TeamUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'member';
}

/** Build a query string from filter values, skipping empty ones. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    search.set(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}
