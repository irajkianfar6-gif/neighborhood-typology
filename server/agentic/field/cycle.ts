/** وضعیت چرخهٔ کامل میدان و یادگیری برای یک محله: پایه → کارزار → میدان → بازسنجی → پایش → یادگیری */
import { requireEntry } from '../state';
import { listCampaigns } from './campaign';
import { listMonitoring } from './monitoring';
import { listProposals } from './learning';

export function fieldCycle(neighborhoodId: string) {
  const e = requireEntry(neighborhoodId);
  const cs = listCampaigns(e.neighborhoodId);
  const active = cs.find((c) => c.status === 'draft' || c.status === 'fielding') ?? null;
  const closed = cs.find((c) => c.status === 'closed') ?? null;
  const latest = active ?? closed;
  const ms = listMonitoring(e.neighborhoodId);
  const props = listProposals().filter((p) => JSON.stringify(p.evidence).includes(e.neighborhoodId));
  const stages = [
    { key: 'baseline', title: 'سنجش پایه', done: Boolean(latest) },
    { key: 'campaign', title: 'طرح کارزار میدانی', done: Boolean(latest) },
    { key: 'approval', title: 'تأیید شروع میدانی (کارشناس)', done: Boolean(closed || (active && active.approval.status === 'approved')) },
    { key: 'fielding', title: 'گردآوری میدانی', done: Boolean(closed) },
    { key: 'remeasure', title: 'بازسنجی با دادهٔ میدانی', done: Boolean(closed?.outcome) },
    { key: 'monitoring', title: 'پایش پس از مداخله', done: ms.some((m) => m.evaluations.length > 0) },
    { key: 'learning', title: 'یادگیری و واسنجی (تصمیم کارشناس)', done: props.some((p) => p.status !== 'proposed') },
  ];
  const next = active?.status === 'draft' ? 'کارزار را بازبینی و شروع میدانی را تأیید کنید'
    : active?.status === 'fielding' ? 'پاسخ‌ها را در زبانهٔ «دادهٔ پیمایشی» وارد کنید و پس از کفایت، کارزار را ببندید'
    : !closed ? 'یک کارزار میدانی بسازید'
    : !ms.length ? 'مداخلهٔ اجراشده را برای پایش ثبت کنید' : !ms.some((m) => m.evaluations.length) ? 'پایش مداخله را ارزیابی کنید'
    : props.some((p) => p.status === 'proposed') ? 'پیشنهادهای واسنجی را بررسی و تصمیم بگیرید' : 'پیشنهادهای یادگیری را تولید کنید';
  return { neighborhoodId: e.neighborhoodId, nameFa: `${e.nameFa}، ${e.cityFa}`, stages, complete: stages.every((s) => s.done), next, campaigns: cs.map((c) => ({ id: c.id, status: c.status, createdAt: c.createdAt, outcome: c.outcome })), monitoring: ms.map((m) => ({ id: m.id, libraryId: m.libraryId, name: m.name, dueDate: m.dueDate, last: m.evaluations.at(-1) ?? null })), proposals: props.map((p) => ({ id: p.id, kind: p.kind, title: p.title, status: p.status })) };
}
