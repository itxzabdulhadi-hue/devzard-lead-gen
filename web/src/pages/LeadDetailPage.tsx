import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  CheckCircle2,
  ExternalLink,
  Globe,
  Instagram,
  Facebook,
  Linkedin,
  Mail,
  MapPin,
  MinusCircle,
  Phone,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  api,
  LEAD_STATUSES,
  type AnalysisData,
  type LeadDetail,
  type LeadStatus,
  type ScoreSignal,
  type TeamUser,
} from '../lib/api';
import { useApi } from '../lib/hooks';
import { Button } from '../components/ui/button';
import {
  Card,
  CardBody,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  Spinner,
  Badge,
  Textarea,
  EmptyState,
} from '../components/ui/primitives';
import { ScoreRing } from '../components/ui/score';
import { useToast } from '../components/ui/toast';
import { cn, formatDate, STATUS_STYLES } from '../lib/utils';

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { push } = useToast();
  const { data, loading, error, refetch } = useApi<LeadDetail>(id ? `/api/leads/${id}` : null);
  const { data: team } = useApi<{ users: TeamUser[] }>('/api/settings/users');
  const [analyzing, setAnalyzing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [status, setStatus] = useState<LeadStatus>('new');
  const [notes, setNotes] = useState('');
  const [tags, setTags] = useState('');
  const [followUpAt, setFollowUpAt] = useState('');
  const [assignedTo, setAssignedTo] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setStatus(data.lead.status);
    setNotes(data.lead.notes ?? '');
    setTags(data.lead.tags.join(', '));
    setFollowUpAt(data.lead.followUpAt ? data.lead.followUpAt.slice(0, 10) : '');
    setAssignedTo(data.lead.assignedTo ?? '');
  }, [data]);

  const save = async (patch?: Record<string, unknown>) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = patch ?? {
        status,
        notes: notes || null,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
        followUpAt: followUpAt || null,
        assignedTo: assignedTo || null,
      };
      await api.patch(`/api/leads/${id}`, body);
      push('success', 'Lead updated.');
      await refetch();
    } catch (err) {
      push('error', (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const analyze = async () => {
    setAnalyzing(true);
    try {
      await api.post(`/api/leads/${id}/analyze`);
      push('success', 'Website analysis complete.');
      await refetch();
    } catch (err) {
      push('error', (err as Error).message);
      await refetch();
    } finally {
      setAnalyzing(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this lead and its business record? This cannot be undone.')) return;
    setDeleting(true);
    try {
      await api.delete(`/api/leads/${id}`);
      push('success', 'Lead deleted.');
      navigate('/leads');
    } catch (err) {
      push('error', (err as Error).message);
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card>
          <EmptyState
            icon={<Building2 size={20} />}
            title="Lead not found"
            description={(error as Error)?.message ?? 'It may have been deleted.'}
            action={
              <Link to="/leads" className="text-sm font-medium text-gold-400 hover:text-gold-300">
                ← Back to leads
              </Link>
            }
          />
        </Card>
      </div>
    );
  }

  const { business, lead, score, analysis } = data;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 lg:p-7">
      <div>
        <Link
          to="/leads"
          className="inline-flex items-center gap-1.5 text-[12.5px] text-zinc-500 transition-colors hover:text-zinc-300"
        >
          <ArrowLeft size={14} /> All leads
        </Link>
      </div>

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-zinc-50">{business.name}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-zinc-500">
            <span>{business.category ?? 'Uncategorized'}</span>
            <span>·</span>
            <span>{[business.city, business.country].filter(Boolean).join(', ') || 'Unknown location'}</span>
            <span>·</span>
            <span className="capitalize">
              source: {business.source}
              {business.sourceConfidence !== null && ` (${Math.round(business.sourceConfidence * 100)}% confidence)`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn('border px-2.5 py-1 text-[12px] capitalize', STATUS_STYLES[lead.status])}>
            {lead.status}
          </Badge>
          <Button variant="secondary" loading={analyzing} onClick={analyze}>
            <RefreshCw size={14} /> Re-analyze website
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_400px]">
        {/* Left column */}
        <div className="space-y-5">
          {/* Opportunity score */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles size={13} className="text-gold-400" /> Opportunity score — and exactly why
              </CardTitle>
            </CardHeader>
            <CardBody>
              {score ? (
                <div className="grid gap-6 sm:grid-cols-[150px_1fr]">
                  <div className="flex flex-col items-center gap-3">
                    <ScoreRing score={score.totalScore} />
                    <span className="text-[11px] text-zinc-600">Evidence of digital opportunity — not a prediction of conversion.</span>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <SubScore label="Website" value={score.websiteScore} max={40} />
                      <SubScore label="Presence" value={score.presenceScore} max={30} />
                      <SubScore label="Business fit" value={score.fitScore} max={20} />
                      <SubScore label="Data quality" value={score.dataQualityScore} max={10} />
                    </div>
                    <div className="space-y-1.5">
                      {score.reasons.signals.map((s) => (
                        <SignalRow key={s.type} signal={s} />
                      ))}
                    </div>
                    <div className="text-[11.5px] text-zinc-600">
                      Calculated {formatDate(score.calculatedAt, true)} · scoring config {score.configVersion ?? 'default'}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-[13px] text-zinc-500">
                  No score yet. Run a website analysis to compute one.
                </p>
              )}
            </CardBody>
          </Card>

          {/* Website audit */}
          <Card>
            <CardHeader className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <Globe size={13} /> Website analysis
              </CardTitle>
              {business.website && (
                <a
                  href={business.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-[12px] text-cyan-400/90 hover:text-cyan-300"
                >
                  {business.website.replace(/^https?:\/\//, '')} <ExternalLink size={11} />
                </a>
              )}
            </CardHeader>
            <CardBody>
              {!business.website ? (
                <EmptyState
                  icon={<Globe size={18} />}
                  title="No website analysis available."
                  description="This business does not have a detected website — which is itself the strongest opportunity signal."
                />
              ) : !analysis ? (
                <div className="py-4 text-center">
                  <p className="text-[13px] text-zinc-400">
                    Not analyzed yet. Run the analyzer to audit this website.
                  </p>
                  <Button variant="primary" size="sm" className="mt-3" loading={analyzing} onClick={analyze}>
                    <Sparkles size={14} /> Analyze now
                  </Button>
                </div>
              ) : (
                <AuditView analysis={analysis} />
              )}
            </CardBody>
          </Card>

          {/* Business info */}
          <Card>
            <CardHeader>
              <CardTitle>Business information</CardTitle>
            </CardHeader>
            <CardBody>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-3.5 sm:grid-cols-2">
                <InfoRow icon={<Building2 size={13} />} label="Name" value={business.name} />
                <InfoRow icon={<Tag size={13} />} label="Category" value={business.category ?? '—'} />
                <InfoRow
                  icon={<MapPin size={13} />}
                  label="Address"
                  value={[business.address, business.city, business.region, business.country]
                    .filter(Boolean)
                    .join(', ')}
                />
                <InfoRow
                  icon={<Phone size={13} />}
                  label="Phone"
                  value={business.phone}
                  href={business.phone ? `tel:${business.phone}` : undefined}
                />
                <InfoRow
                  icon={<Mail size={13} />}
                  label="Email"
                  value={business.email}
                  href={business.email ? `mailto:${business.email}` : undefined}
                />
                <InfoRow
                  icon={<Globe size={13} />}
                  label="Website"
                  value={business.website}
                  href={business.website ?? undefined}
                />
                <InfoRow
                  icon={<Instagram size={13} />}
                  label="Instagram"
                  value={business.instagram}
                  href={business.instagram ?? undefined}
                />
                <InfoRow
                  icon={<Facebook size={13} />}
                  label="Facebook"
                  value={business.facebook}
                  href={business.facebook ?? undefined}
                />
                <InfoRow
                  icon={<Linkedin size={13} />}
                  label="LinkedIn"
                  value={business.linkedin}
                  href={business.linkedin ?? undefined}
                />
                <InfoRow
                  icon={<Building2 size={13} />}
                  label="Source"
                  value={`${business.source} · id ${business.sourceId.slice(0, 13)}…`}
                />
                <InfoRow
                  icon={<CheckCircle2 size={13} />}
                  label="Operating status"
                  value={business.operatingStatus ?? 'unknown'}
                />
                <InfoRow
                  icon={<CalendarClock size={13} />}
                  label="Imported / updated"
                  value={`${formatDate(business.createdAt)} / ${formatDate(business.updatedAt)}`}
                />
              </dl>
            </CardBody>
          </Card>
        </div>

        {/* Right column: CRM */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle>CRM</CardTitle>
            </CardHeader>
            <CardBody className="space-y-4">
              <div>
                <Label>Status</Label>
                <Select
                  value={status}
                  onChange={(e) => {
                    const next = e.target.value as LeadStatus;
                    setStatus(next);
                    void save({ status: next });
                  }}
                >
                  {LEAD_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </Select>
                {lead.contactedAt && (
                  <p className="mt-1.5 text-[11.5px] text-zinc-600">
                    Marked contacted {formatDate(lead.contactedAt, true)}
                  </p>
                )}
              </div>
              <div>
                <Label>Assigned to</Label>
                <Select
                  value={assignedTo}
                  onChange={(e) => {
                    setAssignedTo(e.target.value);
                    void save({ assignedTo: e.target.value || null });
                  }}
                >
                  <option value="">Unassigned</option>
                  {(team?.users ?? []).map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label>Follow-up date</Label>
                <div className="flex gap-2">
                  <Input
                    type="date"
                    value={followUpAt}
                    onChange={(e) => setFollowUpAt(e.target.value)}
                  />
                  <Button
                    size="md"
                    variant="secondary"
                    loading={saving}
                    onClick={() => void save()}
                    title="Save follow-up"
                  >
                    <Save size={14} />
                  </Button>
                </div>
              </div>
              <div>
                <Label>Tags (comma separated)</Label>
                <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="hot, ordering, dubai-marina" />
              </div>
              <div>
                <Label>Notes</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes about this lead…" />
              </div>
              <Button variant="primary" className="w-full" loading={saving} onClick={() => void save()}>
                <Save size={15} /> Save changes
              </Button>
            </CardBody>
          </Card>

          <Card className="border-red-950/60">
            <CardBody className="flex items-center justify-between gap-3 py-4">
              <div>
                <div className="text-[13px] font-medium text-zinc-300">Delete lead</div>
                <div className="text-[11.5px] text-zinc-600">Removes the business + all lead data.</div>
              </div>
              <Button variant="danger" size="sm" loading={deleting} onClick={() => void remove()}>
                <Trash2 size={14} /> Delete
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  );
}

function SubScore({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.round((value / max) * 100);
  return (
    <div className="rounded-lg border border-ink-600 bg-ink-800/60 px-3 py-2.5">
      <div className="text-[10.5px] font-medium uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-0.5 text-[15px] font-semibold tabular-nums text-zinc-100">
        {value}
        <span className="text-[11px] text-zinc-600"> / {max}</span>
      </div>
      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-ink-600">
        <div
          className={cn('h-full rounded-full', pct >= 60 ? 'bg-gold-500' : 'bg-zinc-500')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

const SIGNAL_CATEGORY_STYLES: Record<ScoreSignal['category'], string> = {
  website: 'border-cyan-900/70 bg-cyan-950/20 text-cyan-300',
  presence: 'border-violet-900/70 bg-violet-950/20 text-violet-300',
  fit: 'border-gold-500/25 bg-gold-500/5 text-gold-300',
  data_quality: 'border-ink-500 bg-ink-800 text-zinc-300',
};

function SignalRow({ signal }: { signal: ScoreSignal }) {
  const positive = signal.points > 0;
  return (
    <div
      className={cn(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2 text-[12.5px]',
        SIGNAL_CATEGORY_STYLES[signal.category],
      )}
    >
      {positive ? (
        <Sparkles size={13} className="mt-0.5 shrink-0 opacity-80" />
      ) : (
        <MinusCircle size={13} className="mt-0.5 shrink-0 opacity-80" />
      )}
      <span className="flex-1 leading-5 text-zinc-300">{signal.description}</span>
      <span className="shrink-0 rounded-md bg-black/30 px-1.5 py-0.5 font-mono text-[11px] tabular-nums">
        +{signal.points}
      </span>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
  href,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
  href?: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-zinc-600">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[11px] font-medium uppercase tracking-wide text-zinc-600">{label}</dt>
        <dd className="mt-0.5 break-words text-[13px] text-zinc-200">
          {href && value ? (
            <a
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer noopener"
              className="text-cyan-400/90 hover:text-cyan-300 break-all"
            >
              {value}
            </a>
          ) : (
            value ?? '—'
          )}
        </dd>
      </div>
    </div>
  );
}

function AuditView({ analysis }: { analysis: AnalysisData }) {
  if (analysis.reachable === false || (analysis.error && analysis.reachable === null)) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2.5 rounded-lg border border-red-900/70 bg-red-950/30 px-4 py-3 text-[13px] text-red-300">
          <XCircle size={15} className="shrink-0" />
          <span>Website could not be analyzed{analysis.error ? `: ${analysis.error}` : '.'}</span>
        </div>
        <p className="text-[11.5px] text-zinc-600">
          The technical error is stored for debugging; this does not affect other leads.
        </p>
      </div>
    );
  }

  const checks: Array<{ label: string; ok: boolean | null; hint?: string }> = [
    { label: 'Reachable', ok: analysis.reachable },
    { label: 'HTTPS', ok: analysis.https },
    { label: 'Mobile viewport', ok: analysis.mobileFriendly },
    { label: 'Page title', ok: analysis.hasTitle },
    { label: 'Meta description', ok: analysis.hasMetaDescription },
    { label: 'H1 heading', ok: analysis.hasH1 },
    { label: 'Canonical URL', ok: analysis.canonical },
    { label: 'Structured data (JSON-LD)', ok: analysis.structuredData },
    { label: 'robots.txt', ok: analysis.robotsTxt },
    { label: 'Sitemap', ok: analysis.sitemap },
    { label: 'Contact page', ok: analysis.hasContactPage },
    { label: 'Contact information visible', ok: analysis.hasContactInformation },
    { label: 'WhatsApp', ok: analysis.hasWhatsapp },
    { label: 'Social links', ok: analysis.hasSocialLinks },
    { label: 'Clear call-to-action', ok: analysis.hasCta },
    { label: 'Booking functionality', ok: analysis.hasBooking },
    { label: 'Online ordering', ok: analysis.hasOrdering },
    { label: 'E-commerce detected', ok: analysis.ecommerceDetected },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[12.5px] text-zinc-400">
        <span>
          HTTP status:{' '}
          <strong className={cn('tabular-nums', (analysis.responseStatus ?? 0) < 400 ? 'text-emerald-300' : 'text-red-300')}>
            {analysis.responseStatus ?? '—'}
          </strong>
        </span>
        <span>
          Response time: <strong className="tabular-nums text-zinc-200">{analysis.responseMs ?? '—'} ms</strong>
        </span>
        <span>
          Broken links (sampled):{' '}
          <strong className="tabular-nums text-zinc-200">{analysis.brokenLinksCount ?? '—'}</strong>
        </span>
        <span>
          CMS: <strong className="text-zinc-200">{analysis.cms ?? 'custom / unknown'}</strong>
        </span>
        <span>Analyzed {formatDate(analysis.analyzedAt, true)}</span>
      </div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
        {checks.map((c) => (
          <div key={c.label} className="flex items-center gap-2 py-0.5 text-[12.5px]">
            {c.ok === true ? (
              <CheckCircle2 size={14} className="shrink-0 text-emerald-400" />
            ) : c.ok === false ? (
              <XCircle size={14} className="shrink-0 text-red-400" />
            ) : (
              <MinusCircle size={14} className="shrink-0 text-zinc-600" />
            )}
            <span className={cn(c.ok === null ? 'text-zinc-600' : 'text-zinc-300')}>{c.label}</span>
          </div>
        ))}
      </div>
      {analysis.error && (
        <p className="rounded-md border border-amber-900/60 bg-amber-950/20 px-3 py-2 text-[12px] text-amber-300">
          Partial audit — {analysis.error}
        </p>
      )}
    </div>
  );
}

void useMemo; // (kept imports minimal)
