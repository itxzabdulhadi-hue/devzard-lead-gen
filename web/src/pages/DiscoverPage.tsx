import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  Search,
  Download,
  Database,
  Globe,
  HardDrive,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { api, type DataSourceInfo, type DiscoveryPreview, type ImportResult, type SearchResult } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Input, Label, Select, Spinner, Badge, EmptyState } from '../components/ui/primitives';
import { useToast } from '../components/ui/toast';

interface DiscoveryForm {
  provider: string;
  country: string;
  region: string;
  city: string;
  category: string;
  keyword: string;
  limit: number;
}

export default function DiscoverPage() {
  const { push } = useToast();
  const { data: sources } = useApi<{ sources: DataSourceInfo[] }>('/api/data-sources');
  const [form, setForm] = useState<DiscoveryForm>({
    provider: 'fixture',
    country: 'United Arab Emirates',
    region: '',
    city: 'Dubai',
    category: 'restaurant',
    keyword: '',
    limit: 100,
  });
  const [searching, setSearching] = useState(false);
  const [importing, setImporting] = useState(false);
  const [analyzeAfter, setAnalyzeAfter] = useState(true);
  const [result, setResult] = useState<SearchResult | null>(null);
  const [imported, setImported] = useState<ImportResult | null>(null);

  const providers = sources?.sources ?? [];
  const selected = providers.find((p) => p.id === form.provider);

  const set = (patch: Partial<DiscoveryForm>) => setForm((f) => ({ ...f, ...patch }));

  const search = async (e?: FormEvent) => {
    e?.preventDefault();
    setResult(null);
    setImported(null);
    setSearching(true);
    try {
      const d = await api.post<SearchResult>('/api/leads/search', form);
      setResult(d);
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const runImport = async () => {
    setImporting(true);
    try {
      const d = await api.post<ImportResult>('/api/leads/import', { ...form, analyzeAfterImport: analyzeAfter });
      setImported(d);
      push('success', d.message);
      if (analyzeAfter && d.analysisJobId) {
        push('success', 'Website analysis queued — watch progress on the Leads page.');
      }
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 lg:p-7">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Discover businesses</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">
          Query public open-data sources, preview the matches, then import selected records into your
          pipeline. Nothing is contacted automatically — every lead goes through human review.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
        {/* Filters */}
        <Card className="self-start">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Search size={13} /> Search filters
            </CardTitle>
          </CardHeader>
          <CardBody className="space-y-4">
            <form onSubmit={search} className="space-y-4">
              <div>
                <Label>Data source</Label>
                <Select value={form.provider} onChange={(e) => set({ provider: e.target.value })}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                      {p.requiresInternet ? ' (needs internet)' : ''}
                    </option>
                  ))}
                </Select>
                {selected && (
                  <div className="mt-2 flex items-start gap-1.5 text-[11.5px] leading-4 text-zinc-500">
                    {selected.requiresInternet ? (
                      <Globe size={12} className="mt-0.5 shrink-0" />
                    ) : (
                      <HardDrive size={12} className="mt-0.5 shrink-0" />
                    )}
                    <span>{selected.description}</span>
                  </div>
                )}
              </div>
              <div>
                <Label>Country</Label>
                <Input
                  value={form.country}
                  onChange={(e) => set({ country: e.target.value })}
                  placeholder="United Arab Emirates"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Region / state</Label>
                  <Input value={form.region} onChange={(e) => set({ region: e.target.value })} placeholder="Dubai" />
                </div>
                <div>
                  <Label>City</Label>
                  <Input value={form.city} onChange={(e) => set({ city: e.target.value })} placeholder="Dubai" />
                </div>
              </div>
              <div>
                <Label>Category</Label>
                <Input
                  value={form.category}
                  onChange={(e) => set({ category: e.target.value })}
                  placeholder="restaurant, gym, salon…"
                />
              </div>
              <div>
                <Label>Keyword in name</Label>
                <Input
                  value={form.keyword}
                  onChange={(e) => set({ keyword: e.target.value })}
                  placeholder="e.g. mandi"
                />
              </div>
              <div>
                <Label>Limit</Label>
                <Input
                  type="number"
                  min={1}
                  max={1000}
                  value={form.limit}
                  onChange={(e) => set({ limit: Number(e.target.value) })}
                />
              </div>
              <Button type="submit" variant="primary" loading={searching} className="w-full">
                <Search size={15} /> Find Businesses
              </Button>
            </form>
          </CardBody>
        </Card>

        {/* Results */}
        <div className="space-y-5">
          {searching && (
            <Card>
              <div className="flex items-center justify-center gap-3 py-14 text-sm text-zinc-400">
                <Spinner className="h-5 w-5" /> Querying the dataset…
              </div>
            </Card>
          )}

          {!searching && !result && !imported && (
            <Card>
              <EmptyState
                icon={<Database size={20} />}
                title="No search yet"
                description="Pick a location and category, then run your first search. Try the preset: United Arab Emirates → Dubai → restaurant → 100."
              />
            </Card>
          )}

          {result && (
            <Card className="animate-fade-in">
              <CardHeader className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Search results</CardTitle>
                <div className="flex items-center gap-2 text-[12.5px] text-zinc-400">
                  <Badge className="bg-ink-700 text-zinc-300">{result.provider.label}</Badge>
                  <span>
                    <strong className="text-gold-300">{result.discovered.toLocaleString()}</strong>{' '}
                    businesses matched
                  </span>
                </div>
              </CardHeader>
              <CardBody className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-ink-600/70 text-left text-[11px] uppercase tracking-wide text-zinc-500">
                        <th className="px-5 py-2.5 font-medium">Business</th>
                        <th className="px-3 py-2.5 font-medium">Category</th>
                        <th className="px-3 py-2.5 font-medium">City</th>
                        <th className="px-3 py-2.5 font-medium">Website</th>
                        <th className="px-3 py-2.5 font-medium">Phone</th>
                        <th className="px-5 py-2.5 font-medium">Social</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-ink-700/60">
                      {result.preview.map((p) => (
                        <PreviewRow key={p.sourceId} row={p} />
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink-600/70 px-5 py-4">
                  <label className="flex items-center gap-2 text-[13px] text-zinc-300">
                    <input
                      type="checkbox"
                      checked={analyzeAfter}
                      onChange={(e) => setAnalyzeAfter(e.target.checked)}
                      className="h-4 w-4 rounded border-ink-500 bg-ink-800 accent-gold-500"
                    />
                    Analyze websites after import (background worker)
                  </label>
                  <Button variant="primary" loading={importing} onClick={runImport}>
                    <Download size={15} /> Import up to {form.limit} businesses
                    <ArrowRight size={14} />
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}

          {imported && (
            <Card className="animate-fade-in">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-emerald-300">
                  <ShieldCheck size={14} /> Import complete
                </CardTitle>
              </CardHeader>
              <CardBody>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <ImportStat label="Discovered" value={imported.discovered} />
                  <ImportStat label="Imported" value={imported.imported} gold />
                  <ImportStat label="Already existed" value={imported.alreadyExisting} />
                  <ImportStat label="Duplicates skipped" value={imported.duplicatesSkipped} />
                </div>
                <p className="mt-4 text-[13px] text-zinc-400">{imported.message}</p>
                <div className="mt-4 flex gap-3">
                  <Link
                    to="/leads?status=new"
                    className="inline-flex h-9.5 items-center gap-2 rounded-md bg-gold-500 px-4 text-sm font-semibold text-ink-950 hover:bg-gold-400"
                  >
                    Open lead list <ArrowRight size={14} />
                  </Link>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewRow({ row }: { row: DiscoveryPreview }) {
  const hasSocial = row.socials.length > 0;
  return (
    <tr className="transition-colors hover:bg-ink-800/50">
      <td className="px-5 py-2.5 font-medium text-zinc-100">{row.name}</td>
      <td className="px-3 py-2.5 text-zinc-400">{row.category ?? '—'}</td>
      <td className="px-3 py-2.5 text-zinc-400">{row.city ?? '—'}</td>
      <td className="max-w-52 truncate px-3 py-2.5 text-zinc-400">
        {row.website ? (
          <span className="text-cyan-400/90">{row.website}</span>
        ) : (
          <span className="text-zinc-600">none</span>
        )}
      </td>
      <td className="px-3 py-2.5 tabular-nums text-zinc-400">{row.phone ?? '—'}</td>
      <td className="px-5 py-2.5 text-zinc-400">
        {hasSocial ? `${row.socials.length} profile${row.socials.length > 1 ? 's' : ''}` : '—'}
      </td>
    </tr>
  );
}

function ImportStat({ label, value, gold }: { label: string; value: number; gold?: boolean }) {
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800/60 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${gold ? 'text-gold-300' : 'text-zinc-100'}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
