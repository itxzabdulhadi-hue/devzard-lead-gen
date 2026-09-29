import { Badge } from './primitives';
import { scoreBand, STATUS_STYLES, cn } from '../../lib/utils';
import type { LeadStatus } from '../../lib/api';

export function ScorePill({ score, className }: { score: number | null; className?: string }) {
  const band = scoreBand(score);
  return (
    <Badge className={cn('font-mono text-[12px] tabular-nums', band.className, className)}>
      {score === null ? '—' : score}
      <span className="opacity-60">/100</span>
      <span className="ml-1 opacity-80 text-[10px] uppercase tracking-wide">{band.label}</span>
    </Badge>
  );
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge className={cn('border capitalize', STATUS_STYLES[status] ?? 'bg-ink-700 text-zinc-300 border-ink-500')}>
      {status}
    </Badge>
  );
}

export function ScoreRing({ score, size = 120 }: { score: number | null; size?: number }) {
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const band = scoreBand(score);
  const progress = ((score ?? 0) / 100) * circumference;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#1b1b22"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={band.ring}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${progress} ${circumference}`}
          className="transition-[stroke-dasharray] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-semibold tabular-nums text-zinc-50">{score ?? '—'}</span>
        <span className="text-[11px] text-zinc-500">of 100</span>
      </div>
    </div>
  );
}
