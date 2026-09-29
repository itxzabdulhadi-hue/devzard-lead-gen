import { Link } from 'react-router-dom';
import {
  Building2,
  Star,
  Users,
  PhoneOutgoing,
  HeartHandshake,
  CalendarClock,
  FileText,
  Trophy,
  Globe2,
  FolderTree,
  Radar,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useApi } from '../lib/hooks';
import type { DashboardStats } from '../lib/api';
import { Card, CardBody, CardHeader, CardTitle, EmptyState, Spinner } from '../components/ui/primitives';
import { ScorePill, StatusBadge } from '../components/ui/score';
import { formatDate } from '../lib/utils';

const GOLD = '#c9a227';

export default function DashboardPage() {
  const { data, loading, error } = useApi<DashboardStats>('/api/dashboard/stats');

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={<Radar size={20} />}
        title="Dashboard could not be loaded"
        description={(error as Error | null)?.message ?? 'Please try again.'}
      />
    );
  }

  const pipelineCards = [
    { label: 'Qualified', value: data.pipeline.qualified, icon: Star },
    { label: 'Contacted', value: data.pipeline.contacted, icon: PhoneOutgoing },
    { label: 'Interested', value: data.pipeline.interested, icon: HeartHandshake },
    { label: 'Meetings', value: data.pipeline.meeting, icon: CalendarClock },
    { label: 'Proposals', value: data.pipeline.proposal, icon: FileText },
    { label: 'Won', value: data.pipeline.won, icon: Trophy },
  ];

  const marketData = data.topCities.map((c) => ({
    name: `${c.city}${c.country ? ` · ${c.country}` : ''}`,
    count: c.count,
    avgScore: c.avgScore,
  }));
  const categoryData = data.topCategories.map((c) => ({
    name: c.category,
    count: c.count,
    avgScore: c.avgScore,
  }));

  const empty = data.totals.businesses === 0;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-5 lg:p-7">
      <header>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-50">Dashboard</h1>
        <p className="mt-0.5 text-[13px] text-zinc-500">
          Every number below is computed live from the database.
        </p>
      </header>

      {empty ? (
        <Card>
          <EmptyState
            icon={<Radar size={20} />}
            title="No leads yet."
            description="Run your first business search to start building your pipeline."
            action={
              <Link
                to="/discover"
                className="inline-flex h-9.5 items-center rounded-md bg-gold-500 px-4 text-sm font-semibold text-ink-950 hover:bg-gold-400"
              >
                Find businesses
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {/* Headline stats */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              icon={<Building2 size={16} />}
              label="Total businesses"
              value={data.totals.businesses}
              sub={`${data.totals.analyzed} analyzed · ${data.totals.reachable} reachable`}
            />
            <StatCard
              icon={<Star size={16} />}
              label="High-opportunity leads"
              value={data.totals.highOpportunity}
              sub="Score 70+ of 100"
              accent
            />
            <StatCard
              icon={<Users size={16} />}
              label="In pipeline"
              value={Object.values(data.pipeline).reduce((a, b) => a + b, 0)}
              sub="Leads under review"
            />
            <StatCard
              icon={<PhoneOutgoing size={16} />}
              label="Contacted +"
              value={
                data.pipeline.contacted +
                data.pipeline.interested +
                data.pipeline.meeting +
                data.pipeline.proposal +
                data.pipeline.won
              }
              sub="Beyond first contact"
            />
          </div>

          {/* Pipeline stages */}
          <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
            {pipelineCards.map(({ label, value, icon: Icon }) => (
              <Card key={label} className="p-4">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
                  <Icon size={13} /> {label}
                </div>
                <div className="mt-1.5 text-2xl font-semibold tabular-nums text-zinc-100">{value}</div>
              </Card>
            ))}
          </div>

          {/* Charts */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderTree size={13} /> Top categories
                </CardTitle>
              </CardHeader>
              <CardBody className="pt-2">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={categoryData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke="#1b1b22" />
                      <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={110}
                        tick={{ fill: '#a1a1aa', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(201,162,39,0.06)' }}
                        contentStyle={tooltipStyle}
                        formatter={((v: unknown) => [`${v} businesses`, 'Count']) as never}
                      />
                      <Bar dataKey="count" fill={GOLD} radius={[0, 4, 4, 0]} barSize={16} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Globe2 size={13} /> Top markets (city)
                </CardTitle>
              </CardHeader>
              <CardBody className="pt-2">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={marketData} layout="vertical" margin={{ left: 8, right: 16 }}>
                      <CartesianGrid horizontal={false} stroke="#1b1b22" />
                      <XAxis type="number" tick={{ fill: '#71717a', fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <YAxis
                        type="category"
                        dataKey="name"
                        width={130}
                        tick={{ fill: '#a1a1aa', fontSize: 11 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip cursor={{ fill: 'rgba(201,162,39,0.06)' }} contentStyle={tooltipStyle} />
                      <Bar dataKey="count" fill="#3d3d4a" radius={[0, 4, 4, 0]} barSize={16}>
                        {marketData.map((_entry, i) => (
                          <Cell key={i} fill={i === 0 ? GOLD : '#3d3d4a'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardBody>
            </Card>
          </div>

          {/* Recent leads */}
          <Card>
            <CardHeader className="flex items-center justify-between">
              <CardTitle>Recent leads</CardTitle>
              <Link to="/leads" className="text-[12.5px] font-medium text-gold-400 hover:text-gold-300">
                View all →
              </Link>
            </CardHeader>
            <div className="divide-y divide-ink-700/60">
              {data.recentLeads.length === 0 && (
                <div className="px-5 py-8 text-center text-[13px] text-zinc-500">No leads imported yet.</div>
              )}
              {data.recentLeads.map((r) => (
                <Link
                  key={r.id}
                  to={`/leads/${r.id}`}
                  className="flex items-center gap-4 px-5 py-3 transition-colors hover:bg-ink-800/60"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-zinc-100">{r.name}</div>
                    <div className="mt-0.5 text-[12px] text-zinc-500">
                      {[r.category, r.city, r.country].filter(Boolean).join(' · ')} · imported{' '}
                      {formatDate(r.createdAt)}
                    </div>
                  </div>
                  <ScorePill score={r.score} />
                  <StatusBadge status={r.status} />
                </Link>
              ))}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | string;
  sub: string;
  accent?: boolean;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        <span className={accent ? 'text-gold-400' : ''}>{icon}</span> {label}
      </div>
      <div
        className={`mt-1.5 text-2xl font-semibold tabular-nums ${accent ? 'text-gold-300' : 'text-zinc-100'}`}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11.5px] text-zinc-600">{sub}</div>
    </Card>
  );
}

const tooltipStyle = {
  background: '#14141a',
  border: '1px solid #2f2f3a',
  borderRadius: 8,
  fontSize: 12,
  color: '#e4e4e7',
} as const;
