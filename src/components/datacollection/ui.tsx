import React from 'react';
import type { PlanStatus } from '../../algorithm/dataCollectionApi';

export const fa = (n: number | null | undefined, digits = 0) =>
  n === null || n === undefined || !Number.isFinite(n) ? '—' : n.toLocaleString('fa-IR', { maximumFractionDigits: digits, minimumFractionDigits: 0 });

export function ProgressRing({ value, size = 64, stroke = 7, label, tone = 'brand' }: { value: number; size?: number; stroke?: number; label?: React.ReactNode; tone?: 'brand' | 'ok' | 'warn' | 'danger' }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(1, value));
  const color = { brand: 'stroke-brand-700 dark:stroke-signal-400', ok: 'stroke-emerald-500', warn: 'stroke-amber-500', danger: 'stroke-rose-500' }[tone];
  return (
    <div className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(v * 100)} درصد`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-black/5 dark:stroke-white/10" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} className={`fill-none transition-[stroke-dashoffset] duration-700 ${color}`} />
      </svg>
      <span className="absolute text-center text-[11px] font-black leading-tight text-ink-800 dark:text-white">{label ?? `${fa(v * 100)}٪`}</span>
    </div>
  );
}

export const STATUS_FA: Record<PlanStatus, { label: string; cls: string }> = {
  ready: { label: 'آماده', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800' },
  partial: { label: 'در جریان', cls: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800' },
  empty: { label: 'بدون داده', cls: 'bg-slate-50 text-slate-500 border-slate-200 dark:bg-wall-850 dark:text-slate-400 dark:border-wall-700' },
};

export function StatusPill({ status, children }: { status: PlanStatus; children?: React.ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black ${STATUS_FA[status].cls}`}>{children ?? STATUS_FA[status].label}</span>;
}

export function Bar({ value, max = 100, tone = 'brand', marker }: { value: number | null; max?: number; tone?: 'brand' | 'ok' | 'warn' | 'danger' | 'info'; marker?: number }) {
  const pct = value === null ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  const color = { brand: 'bg-brand-700 dark:bg-signal-400', ok: 'bg-emerald-500', warn: 'bg-amber-500', danger: 'bg-rose-500', info: 'bg-sky-500' }[tone];
  return (
    <div className="relative h-2 w-full overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
      <div className={`h-full rounded-full transition-all duration-700 ${color}`} style={{ width: `${pct}%` }} />
      {marker !== undefined && <div className="absolute top-0 h-full w-0.5 bg-ink-800/60 dark:bg-white/60" style={{ right: `${Math.max(0, Math.min(100, (marker / max) * 100))}%` }} />}
    </div>
  );
}

export function Card({ title, icon, actions, children, className = '' }: { title?: React.ReactNode; icon?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-4 dark:border-wall-700 dark:bg-wall-800 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h4 className="flex items-center gap-2 text-xs font-black text-ink-900 dark:text-white">{icon}{title}</h4>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Stepper({ steps, current, onJump, done }: { steps: string[]; current: number; onJump?: (i: number) => void; done?: (i: number) => boolean }) {
  return (
    <ol className="flex w-full items-center gap-1 overflow-x-auto pb-1" aria-label="مراحل">
      {steps.map((s, i) => {
        const isDone = done ? done(i) : i < current;
        const active = i === current;
        return (
          <li key={s} className={`flex items-center gap-1 ${active ? 'shrink-0' : 'min-w-0 flex-1'}`}>
            <button type="button" onClick={() => onJump?.(i)} disabled={!onJump} aria-current={active ? 'step' : undefined} title={s}
              className={`flex shrink-0 items-center gap-1.5 rounded-xl px-2 py-1.5 text-[10px] font-black transition ${active ? 'bg-brand-800 text-white dark:bg-signal-400 dark:text-wall-950' : isDone ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300' : 'text-ink-400 hover:bg-black/5 dark:text-slate-500 dark:hover:bg-white/5'}`}>
              <span className={`flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] ${active ? 'bg-white/20' : isDone ? 'bg-emerald-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>{isDone && !active ? '✓' : fa(i + 1)}</span>
              {active && <span className="whitespace-nowrap">{s}</span>}
            </button>
            {i < steps.length - 1 && <span className={`h-0.5 min-w-2 flex-1 rounded ${isDone ? 'bg-emerald-400' : 'bg-line dark:bg-wall-700'}`} />}
          </li>
        );
      })}
    </ol>
  );
}

export function Notice({ tone, children }: { tone: 'ok' | 'warn' | 'danger' | 'info'; children: React.ReactNode }) {
  const cls = {
    ok: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200',
    warn: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200',
    danger: 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-900/20 dark:text-rose-200',
    info: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800 dark:bg-sky-900/20 dark:text-sky-200',
  }[tone];
  return <div role={tone === 'danger' ? 'alert' : 'status'} className={`rounded-xl border px-3 py-2 text-xs font-bold leading-6 ${cls}`}>{children}</div>;
}

export const inputCls = 'w-full rounded-xl border border-line bg-paper px-3 py-2 text-xs outline-none transition focus-visible:border-brand-400 focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-850 dark:text-slate-100';
export const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-xl bg-brand-800 px-4 py-2 text-xs font-black text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-signal-400 dark:text-wall-950';
export const ghostBtn = 'inline-flex items-center justify-center gap-2 rounded-xl border border-line px-3 py-2 text-xs font-black text-ink-600 transition hover:border-brand-300 hover:text-brand-800 disabled:opacity-40 dark:border-wall-700 dark:text-slate-300';
