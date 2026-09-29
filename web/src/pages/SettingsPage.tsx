import { useEffect, useState } from 'react';
import { CheckCircle2, Database, Globe, HardDrive, Save, ShieldCheck, Timer, XCircle } from 'lucide-react';
import { api, type DataSourceInfo, type ScoringConfig } from '../lib/api';
import { useApi } from '../lib/hooks';
import { Button } from '../components/ui/button';
import { Card, CardBody, CardHeader, CardTitle, Input, Label, Spinner, Badge } from '../components/ui/primitives';
import { useToast } from '../components/ui/toast';
import type { SessionUser } from '../components/layout';

interface AnalysisSettings {
  concurrency: number;
  timeoutMs: number;
  delayMs: number;
  perHostDelayMs: number;
  maxRetries: number;
  maxBatch: number;
  maxResponseBytes: number;
  allowPrivateHosts: boolean;
  minConfidence: number;
  importMaxRecords: number;
  note: string;
}

export default function SettingsPage({ user }: { user: SessionUser }) {
  const { push } = useToast();
  const { data: sources, refetch: refetchSources } = useApi<{ sources: DataSourceInfo[] }>('/api/data-sources');
  const { data: analysis } = useApi<{ analysis: AnalysisSettings }>('/api/settings/analysis');
  const { data: scoring, refetch: refetchScoring } = useApi<{ config: ScoringConfig }>('/api/settings/scoring');

  const [fit, setFit] = useState<Record<string, number>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [savingScoring, setSavingScoring] = useState(false);

  useEffect(() => {
    if (scoring?.config) setFit(scoring.config.categoryFit);
  }, [scoring]);

  const isAdmin = user.role === 'admin';

  const testSource = async (id: string) => {
    setTesting(id);
    try {
      const d = await api.post<{ ok: boolean; detail: string }>(`/api/data-sources/${id}/test`);
      push(d.ok ? 'success' : 'error', d.detail);
      await refetchSources();
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setTesting(null);
    }
  };

  const saveScoring = async () => {
    setSavingScoring(true);
    try {
      await api.put('/api/settings/scoring', { categoryFit: fit });
      push('success', 'Scoring configuration saved. Re-run analysis to apply to existing leads.');
      await refetchScoring();
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setSavingScoring(false);
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-5 lg:p-7">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Settings</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">Data sources, scoring configuration and analyzer limits.</p>
      </header>

      {/* Data sources */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database size={13} /> Data sources
          </CardTitle>
        </CardHeader>
        <CardBody className="space-y-4">
          {(sources?.sources ?? []).map((s) => (
            <div key={s.id} className="rounded-lg border border-ink-600 bg-ink-800/40 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  {s.requiresInternet ? (
                    <Globe size={16} className="text-zinc-500" />
                  ) : (
                    <HardDrive size={16} className="text-zinc-500" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 text-[13.5px] font-medium text-zinc-100">
                      {s.label}
                      {s.configured ? (
                        <Badge className="bg-emerald-950/60 text-emerald-300 border border-emerald-900">ready</Badge>
                      ) : (
                        <Badge className="bg-amber-950/60 text-amber-300 border border-amber-900">needs setup</Badge>
                      )}
                      {s.requiresInternet && (
                        <Badge className="bg-ink-700 text-zinc-400">requires internet</Badge>
                      )}
                    </div>
                    <p className="mt-0.5 max-w-xl text-[12px] leading-4 text-zinc-500">{s.description}</p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      License: {s.license}
                      {s.config.overtureUrl ? ` · ${s.config.overtureUrl}` : ''}
                      {s.config.fixturePath ? ` · ${s.config.fixturePath.split('/').slice(-2).join('/')}` : ''}
                    </p>
                  </div>
                </div>
                <Button size="sm" variant="secondary" loading={testing === s.id} onClick={() => void testSource(s.id)}>
                  Test connection
                </Button>
              </div>
              {s.lastTest && (
                <div
                  className={`mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${
                    s.lastTest.ok
                      ? 'border-emerald-900/70 bg-emerald-950/20 text-emerald-300'
                      : 'border-red-900/70 bg-red-950/20 text-red-300'
                  }`}
                >
                  {s.lastTest.ok ? (
                    <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
                  ) : (
                    <XCircle size={13} className="mt-0.5 shrink-0" />
                  )}
                  <span>{s.lastTest.detail}</span>
                  <span className="ml-auto shrink-0 text-zinc-600">
                    {new Date(s.lastTest.testedAt).toLocaleString('en-GB')}
                  </span>
                </div>
              )}
              {!s.requiresInternet && !s.configured && (
                <p className="mt-2 text-[12px] text-amber-300/90">
                  Fixture file missing — run <code className="rounded bg-ink-700 px-1">npm run fixtures:generate</code>.
                </p>
              )}
            </div>
          ))}
        </CardBody>
      </Card>

      {/* Scoring configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck size={13} className="text-gold-400" /> Scoring — business fit categories
          </CardTitle>
        </CardHeader>
        <CardBody>
          {!scoring ? (
            <Spinner className="mx-auto" />
          ) : (
            <>
              <p className="mb-4 text-[12.5px] leading-5 text-zinc-500">
                Max 20 points. Businesses whose category maps to a fit key earn these points on top of
                website (40) and presence (30) signals, plus up to 10 data-quality points — 100 total.
                Values are stored in the database and apply to future score calculations.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(fit).map(([key, value]) => (
                  <div key={key}>
                    <Label>{key}</Label>
                    <Input
                      type="number"
                      min={0}
                      max={20}
                      disabled={!isAdmin}
                      value={value}
                      onChange={(e) => setFit((f) => ({ ...f, [key]: Number(e.target.value) }))}
                    />
                  </div>
                ))}
              </div>
              {isAdmin ? (
                <Button variant="primary" size="sm" className="mt-4" loading={savingScoring} onClick={() => void saveScoring()}>
                  <Save size={14} /> Save scoring configuration
                </Button>
              ) : (
                <p className="mt-4 text-[12px] text-zinc-600">Only admins can change scoring configuration.</p>
              )}
            </>
          )}
        </CardBody>
      </Card>

      {/* Analyzer limits */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Timer size={13} /> Analyzer limits (environment)
          </CardTitle>
        </CardHeader>
        <CardBody>
          {!analysis ? (
            <Spinner className="mx-auto" />
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <LimitStat label="Concurrency" value={String(analysis.analysis.concurrency)} />
              <LimitStat label="Request timeout" value={`${analysis.analysis.timeoutMs / 1000}s`} />
              <LimitStat label="Delay between sites" value={`${analysis.analysis.delayMs} ms`} />
              <LimitStat label="Per-host delay" value={`${analysis.analysis.perHostDelayMs} ms`} />
              <LimitStat label="Retries" value={String(analysis.analysis.maxRetries)} />
              <LimitStat label="Max batch" value={String(analysis.analysis.maxBatch)} />
              <LimitStat label="Max response" value={`${Math.round(analysis.analysis.maxResponseBytes / 1000)} KB`} />
              <LimitStat label="Min source confidence" value={String(analysis.analysis.minConfidence)} />
            </div>
          )}
          <div
            className={`mt-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[12px] ${
              analysis?.analysis.allowPrivateHosts
                ? 'border-red-900/70 bg-red-950/20 text-red-300'
                : 'border-ink-600 bg-ink-800/50 text-zinc-500'
            }`}
          >
            <ShieldCheck size={13} className="mt-0.5 shrink-0" />
            <span>
              {analysis?.analysis.allowPrivateHosts
                ? 'ANALYSIS_ALLOW_PRIVATE_HOSTS=true — private/localhost analysis is enabled for offline development ONLY. Never enable in production.'
                : 'SSRF protection active: the analyzer only fetches public http(s) URLs (no localhost, private ranges, or cloud metadata endpoints).'}
            </span>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

function LimitStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800/60 px-3 py-2.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-zinc-100">{value}</div>
    </div>
  );
}

