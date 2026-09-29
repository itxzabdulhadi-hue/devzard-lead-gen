import { type ClassValue } from './types';

/** Minimal class joiner (clsx-style, dependency-free). */
export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (!v) return;
    if (typeof v === 'string') out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object')
      for (const [k, on] of Object.entries(v)) if (on) out.push(k);
  };
  inputs.forEach(walk);
  return out.join(' ');
}

export function formatDate(value: string | null | undefined, withTime = false): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  const date = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  return withTime
    ? `${date}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
    : date;
}

export function scoreBand(score: number | null | undefined): {
  label: string;
  className: string;
  ring: string;
} {
  if (score === null || score === undefined)
    return { label: '—', className: 'text-zinc-500 bg-ink-700', ring: '#3d3d4a' };
  if (score >= 70)
    return { label: 'High', className: 'text-gold-300 bg-gold-500/10 border border-gold-500/25', ring: '#c9a227' };
  if (score >= 40)
    return { label: 'Medium', className: 'text-zinc-200 bg-ink-700 border border-ink-500', ring: '#8b8b98' };
  return { label: 'Low', className: 'text-zinc-400 bg-ink-800 border border-ink-600', ring: '#52525f' };
}

export const STATUS_STYLES: Record<string, string> = {
  new: 'bg-sky-950/60 text-sky-300 border-sky-900',
  reviewing: 'bg-indigo-950/60 text-indigo-300 border-indigo-900',
  qualified: 'bg-gold-500/10 text-gold-300 border-gold-500/25',
  contacted: 'bg-cyan-950/60 text-cyan-300 border-cyan-900',
  interested: 'bg-emerald-950/60 text-emerald-300 border-emerald-900',
  meeting: 'bg-teal-950/60 text-teal-300 border-teal-900',
  proposal: 'bg-violet-950/60 text-violet-300 border-violet-900',
  won: 'bg-green-950/70 text-green-300 border-green-800',
  lost: 'bg-zinc-900 text-zinc-400 border-zinc-700',
  rejected: 'bg-red-950/50 text-red-400 border-red-900',
};
