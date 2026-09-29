import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  Globe,
  Instagram,
  Linkedin,
  Facebook,
  Phone,
  Search,
  Sparkles,
  Users,
  X,
} from 'lucide-react';
import {
  api,
  LEAD_STATUSES,
  qs,
  type AnalysisJob,
  type LeadRow,
  type LeadStatus,
  type Paginated,
} from '../lib/api';
import { useApi, usePolling } from '../lib/hooks';
import { Button } from '../components/ui/button';
import {
  Card,
  EmptyState,
  Input,
  Label,
  Select,
  Spinner,
  Badge,
} from '../components/ui/primitives';
import { ScorePill, StatusBadge } from '../components/ui/score';
import { Drawer } from '../components/ui/drawer';
import { useToast } from '../components/ui/toast';
import { cn } from '../lib/utils';

type SortKey = 'name' | 'category' | 'country' | 'city' | 'score' | 'status' | 'created_at' | 'updated_at';

interface Filters {
  q: string;
  country: string;
  city: string;
  category: string;
  status: string;
  website: string;
  social: string;
  analyzed: string;
  minScore: string;
  maxScore: string;
  source: string;
}

const EMPTY_FILTERS: Filters = {
  q: '',
  country: '',
  city: '',
  category: '',
  status: '',
  website: 'any',
  social: 'any',
  analyzed: 'any',
  minScore: '',
  maxScore: '',
  source: '',
};

export default function LeadsPage() {
  const { push } = useToast();
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<Filters>({
    ...EMPTY_FILTERS,
    status: searchParams.get('status') ?? '',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({
    key: 'created_at',
    dir: 'desc',
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);

  const query = useMemo(
    () =>
      qs({
        ...filters,
        sort: sort.key,
        dir: sort.dir,
        page,
        pageSize,
      }),
    [filters, sort, page, pageSize],
  );

  const { data, loading, error, refetch } = useApi<Paginated<LeadRow>>(`/api/leads${query}`);

  // Active analysis job progress (banner)
  const jobs = usePolling<{ jobs: AnalysisJob[] }>('/api/analysis/jobs', 2500, true);
  const activeJob = jobs.data?.jobs.find(
    (j) => j.status === 'queued' || j.status === 'running',
  );

  const rows = data?.data ?? [];
  const total = data?.pagination.total ?? 0;
  const totalPages = data?.pagination.totalPages ?? 1;

  const setF = (patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
    setSelected(new Set());
  };

  const toggleSort = (key: SortKey) => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }));
    setPage(1);
  };

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const bulkAnalyze = async () => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const d = await api.post<{ jobId: string; queued: number }>('/api/leads/bulk-analyze', {
        businessIds: [...selected],
      });
      push('success', `Queued ${d.queued} businesses for website analysis.`);
      setSelected(new Set());
      void refetch();
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkStatus = async (status: LeadStatus) => {
    if (selected.size === 0) return;
    setBulkBusy(true);
    try {
      const d = await api.post<{ updated: number }>('/api/leads/bulk-status', {
        businessIds: [...selected],
        status,
      });
      push('success', `${d.updated} lead${d.updated === 1 ? '' : 's'} marked ${status}.`);
      setSelected(new Set());
      void refetch();
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setBulkBusy(false);
    }
  };

  const exportCsv = () => {
    const params = qs({ ...filters, sort: sort.key, dir: sort.dir });
    window.open(`/api/leads/export${params}`, '_blank');
  };

  const activeFilterCount = Object.entries(filters).filter(
    ([k, v]) => v !== '' && !(k === 'website' && v === 'any') && !(k === 'social' && v === 'any') && !(k === 'analyzed' && v === 'any'),
  ).length;

  const filterPanel = (
    <div className="space-y-4">
      <div>
        <Label>Search</Label>
        <Input value={filters.q} onChange={(e) => setF({ q: e.target.value })} placeholder="Name, category, city, website…" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Country</Label>
          <Input value={filters.country} onChange={(e) => setF({ country: e.target.value })} placeholder="AE" />
        </div>
        <div>
          <Label>City</Label>
          <Input value={filters.city} onChange={(e) => setF({ city: e.target.value })} placeholder="Dubai" />
        </div>
      </div>
      <div>
        <Label>Category</Label>
        <Input value={filters.category} onChange={(e) => setF({ category: e.target.value })} placeholder="restaurant" />
      </div>
      <div>
        <Label>Status</Label>
        <Select value={filters.status} onChange={(e) => setF({ status: e.target.value })}>
          <option value="">Any status</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      <div>
        <Label>Website</Label>
        <Select value={filters.website} onChange={(e) => setF({ website: e.target.value })}>
          <option value="any">Any</option>
          <option value="has">Has website</option>
          <option value="none">No website</option>
          <option value="unreachable">Website unreachable</option>
          <option value="poor">Poor website (unreachable / not mobile-friendly)</option>
        </Select>
      </div>
      <div>
        <Label>Social</Label>
        <Select value={filters.social} onChange={(e) => setF({ social: e.target.value })}>
          <option value="any">Any</option>
          <option value="any_social">Has any social profile</option>
          <option value="instagram">Has Instagram</option>
          <option value="facebook">Has Facebook</option>
          <option value="linkedin">Has LinkedIn</option>
          <option value="social_no_website">Has social but no website</option>
        </Select>
      </div>
      <div>
        <Label>Analysis</Label>
        <Select value={filters.analyzed} onChange={(e) => setF({ analyzed: e.target.value })}>
          <option value="any">Any</option>
          <option value="yes">Analyzed</option>
          <option value="no">Not analyzed</option>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Min score</Label>
          <Input type="number" min={0} max={100} value={filters.minScore} onChange={(e) => setF({ minScore: e.target.value })} placeholder="70" />
        </div>
        <div>
          <Label>Max score</Label>
          <Input type="number" min={0} max={100} value={filters.maxScore} onChange={(e) => setF({ maxScore: e.target.value })} />
        </div>
      </div>
      {activeFilterCount > 0 && (
        <Button variant="ghost" className="w-full" onClick={() => setF({ ...EMPTY_FILTERS, status: '' })}>
          <X size={14} /> Clear all filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1400px] space-y-4 p-5 lg:p-7">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Leads</h1>
          <p className="mt-0.5 text-[13px] text-zinc-500">
            {loading ? 'Loading…' : `${total.toLocaleString()} businesses in the pipeline`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" className="lg:hidden" onClick={() => setDrawerOpen(true)}>
            <Filter size={15} /> Filters
            {activeFilterCount > 0 && (
              <Badge className="bg-gold-500/15 text-gold-300">{activeFilterCount}</Badge>
            )}
          </Button>
          <Button variant="secondary" onClick={exportCsv}>
            <Download size={15} /> Export CSV
          </Button>
        </div>
      </header>

      {activeJob && (
        <JobBanner job={activeJob} onDone={() => void refetch()} />
      )}

      <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
        {/* Desktop filters */}
        <Card className="hidden self-start lg:block">
          <div className="border-b border-ink-600/70 px-5 py-3">
            <h2 className="text-[13px] font-semibold uppercase tracking-wide text-zinc-400">Filters</h2>
          </div>
          <div className="p-5">{filterPanel}</div>
        </Card>

        <div className="min-w-0 space-y-3">
          {/* Bulk bar */}
          {selected.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gold-500/25 bg-gold-500/5 px-4 py-2.5 animate-fade-in">
              <span className="text-[13px] font-medium text-gold-200">
                {selected.size} selected
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button size="sm" variant="primary" loading={bulkBusy} onClick={bulkAnalyze}>
                  <Sparkles size={14} /> Analyze websites
                </Button>
                <Select
                  className="h-8 w-40 text-[13px]"
                  value=""
                  disabled={bulkBusy}
                  onChange={(e) => {
                    if (e.target.value) void bulkStatus(e.target.value as LeadStatus);
                  }}
                >
                  <option value="">Set status…</option>
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          )}

          <Card className="overflow-hidden">
            {error ? (
              <EmptyState
                icon={<Users size={20} />}
                title="Could not load leads"
                description={(error as Error).message}
              />
            ) : loading && rows.length === 0 ? (
              <div className="flex h-56 items-center justify-center">
                <Spinner className="h-6 w-6" />
              </div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon={<Users size={20} />}
                title="No leads match these filters"
                description="Try clearing filters, or discover and import new businesses."
                action={
                  <Link
                    to="/discover"
                    className="inline-flex h-9.5 items-center rounded-md bg-gold-500 px-4 text-sm font-semibold text-ink-950 hover:bg-gold-400"
                  >
                    Find businesses
                  </Link>
                }
              />
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[960px] text-[13px]">
                    <thead>
                      <tr className="border-b border-ink-600/70 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                        <th className="w-9 pl-4">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            className="h-3.5 w-3.5 rounded border-ink-500 bg-ink-800 accent-gold-500"
                            aria-label="Select all on page"
                          />
                        </th>
                        <SortableTh label="Business" k="name" sort={sort} onSort={toggleSort} />
                        <SortableTh label="Category" k="category" sort={sort} onSort={toggleSort} />
                        <SortableTh label="Location" k="city" sort={sort} onSort={toggleSort} />
                        <th className="px-3 py-2.5 font-medium">Website</th>
                        <th className="px-3 py-2.5 font-medium">Phone</th>
                        <th className="px-3 py-2.5 font-medium">Social</th>
                        <SortableTh label="Score" k="score" sort={sort} onSort={toggleSort} align="right" />
                        <SortableTh label="Status" k="status" sort={sort} onSort={toggleSort} />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-700/60">
                      {rows.map((r) => (
                        <LeadRowView
                          key={r.id}
                          row={r}
                          selected={selected.has(r.id)}
                          onToggle={() => toggleOne(r.id)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-600/70 px-4 py-3">
                  <div className="flex items-center gap-2 text-[12.5px] text-zinc-500">
                    <span>Rows</span>
                    <Select
                      className="h-8 w-17 text-[12.5px]"
                      value={pageSize}
                      onChange={(e) => {
                        setPageSize(Number(e.target.value));
                        setPage(1);
                      }}
                    >
                      {[25, 50, 100].map((n) => (
                        <option key={n} value={n}>
                          {n}
                        </option>
                      ))}
                    </Select>
                    <span>
                      {total === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of{' '}
                      {total.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      <ChevronLeft size={15} />
                    </Button>
                    <span className="px-2 text-[12.5px] tabular-nums text-zinc-400">
                      {page} / {totalPages}
                    </span>
                    <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                      <ChevronRight size={15} />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </div>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title="Filters">
        {filterPanel}
        <Button variant="primary" className="mt-5 w-full" onClick={() => setDrawerOpen(false)}>
          Apply
        </Button>
      </Drawer>
    </div>
  );
}

function SortableTh({
  label,
  k,
  sort,
  onSort,
  align = 'left',
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: 'asc' | 'desc' };
  onSort: (k: SortKey) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.key === k;
  return (
    <th className={cn('px-3 py-2.5 font-medium', align === 'right' && 'text-right')}>
      <button
        onClick={() => onSort(k)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-zinc-300',
          active && 'text-gold-300',
        )}
      >
        {label}
        {active ? (
          sort.dir === 'asc' ? (
            <ArrowUp size={11} />
          ) : (
            <ArrowDown size={11} />
          )
        ) : (
          <ArrowUpDown size={11} className="opacity-40" />
        )}
      </button>
    </th>
  );
}

function LeadRowView({ row, selected, onToggle }: { row: LeadRow; selected: boolean; onToggle: () => void }) {
  return (
    <tr className={cn('group transition-colors hover:bg-ink-800/50', selected && 'bg-gold-500/5')}>
      <td className="pl-4">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="h-3.5 w-3.5 rounded border-ink-500 bg-ink-800 accent-gold-500"
          aria-label={`Select ${row.name}`}
        />
      </td>
      <td className="max-w-64 px-3 py-2.5">
        <Link to={`/leads/${row.id}`} className="block">
          <span className="block truncate font-medium text-zinc-100 group-hover:text-gold-200">
            {row.name}
          </span>
          <span className="block truncate text-[11.5px] text-zinc-600">
            {row.source} · {row.address ?? row.city ?? '—'}
          </span>
        </Link>
      </td>
      <td className="px-3 py-2.5 text-zinc-400">{row.category ?? '—'}</td>
      <td className="px-3 py-2.5 text-zinc-400">
        {[row.city, row.country].filter(Boolean).join(', ') || '—'}
      </td>
      <td className="max-w-44 px-3 py-2.5">
        {row.website ? (
          <span
            className={cn(
              'inline-flex items-center gap-1 truncate text-[12.5px]',
              row.reachable === true ? 'text-cyan-400/90' : row.reachable === false ? 'text-red-400/80' : 'text-zinc-500',
            )}
            title={row.website}
          >
            <Globe size={11} className="shrink-0" />
            {row.website.replace(/^https?:\/\/(www\.)?/, '')}
          </span>
        ) : (
          <span className="text-[12px] text-zinc-600">no website</span>
        )}
      </td>
      <td className="px-3 py-2.5 tabular-nums text-zinc-400">
        {row.phone ? (
          <span className="inline-flex items-center gap-1" title={row.phone}>
            <Phone size={11} className="text-zinc-600" />
            {row.phone}
          </span>
        ) : (
          '—'
        )}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 text-zinc-500">
          {row.instagram && <span title="Instagram" className="inline-flex"><Instagram size={13} className="text-zinc-400" /></span>}
          {row.facebook && <span title="Facebook" className="inline-flex"><Facebook size={13} className="text-zinc-400" /></span>}
          {row.linkedin && <span title="LinkedIn" className="inline-flex"><Linkedin size={13} className="text-zinc-400" /></span>}
          {!row.instagram && !row.facebook && !row.linkedin && '—'}
        </div>
      </td>
      <td className="px-3 py-2.5 text-right">
        <ScorePill score={row.score} />
      </td>
      <td className="px-3 py-2.5">
        <StatusBadge status={row.leadStatus} />
      </td>
    </tr>
  );
}

function JobBanner({ job, onDone }: { job: AnalysisJob; onDone: () => void }) {
  const pct = job.total > 0 ? Math.round((job.completed / job.total) * 100) : 0;
  const running = job.status === 'queued' || job.status === 'running';
  if (!running && job.status !== 'completed') return null;

  return (
    <Card
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 animate-fade-in',
        running ? 'border-gold-500/30 bg-gold-500/5' : 'border-emerald-900/70 bg-emerald-950/20',
      )}
    >
      {running ? (
        <Spinner className="h-4 w-4" />
      ) : (
        <Sparkles size={15} className="text-emerald-400" />
      )}
      <div className="min-w-40 flex-1">
        <div className="text-[13px] font-medium text-zinc-200">
          {running ? 'Analyzing websites…' : 'Website analysis complete'}
          <span className="ml-2 tabular-nums text-zinc-500">
            {job.completed} / {job.total} · {pct}%
            {job.failed > 0 && <span className="ml-1.5 text-red-400">{job.failed} with issues</span>}
          </span>
        </div>
        <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-ink-700">
          <div
            className={cn('h-full rounded-full transition-all duration-500', running ? 'bg-gold-500' : 'bg-emerald-500')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
      {!running && <Button size="sm" variant="ghost" onClick={onDone}>Refresh</Button>}
    </Card>
  );
}

// search icon used in mobile filter button label
void Search;
