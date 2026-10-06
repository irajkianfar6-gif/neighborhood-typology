import React, { useState } from 'react';
import { Building2, Database, Landmark, Loader2, Upload } from 'lucide-react';
import { stageOfficialPack, type CollectionStatus } from '../../algorithm/dataCollectionApi';
import { Card, Notice, fa, ghostBtn } from './ui';

const BATCH_FA: Record<string, string> = { PENDING_REVIEW: 'در انتظار تأیید مدیر', APPROVED: 'تأییدشده و فعال', REJECTED: 'ردشده', SUPERSEDED: 'جایگزین‌شده' };

/** زمینهٔ رسمی منطقهٔ شهرداری: جمعیت، بازار مسکن، معیار درآمد و بسته‌های دادهٔ رسمی آمادهٔ ورود */
export default function OfficialContextPanel({ status, onChanged }: { status: CollectionStatus; onChanged: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const off = status.official;
  if (!off) return null;
  const p = off.profile;
  const eco = status.survey.economy;

  const stage = async (id: string) => {
    setBusy(id); setMsg(null);
    try {
      const r = await stageOfficialPack(id);
      setMsg({ tone: 'ok', text: `${fa(r.stats.accepted)} ردیف برای ${fa(r.stats.neighborhoods)} محله بارگذاری شد و در انتظار تأیید مدیر است.` });
      onChanged();
    } catch (e) { setMsg({ tone: 'danger', text: e instanceof Error ? e.message : 'بارگذاری ناموفق بود' }); } finally { setBusy(null); }
  };

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <Card title={`منطقهٔ ${fa(off.district)} شهرداری تهران — جمعیت`} icon={<Landmark size={14} />}>
        {!p ? <p className="text-[11px] text-ink-400">دادهٔ رسمی این منطقه در دسترس نیست.</p> : (
          <div className="space-y-1.5 text-[11px]">
            <Row k="جمعیت (سرشماری ۱۳۹۵)" v={p.population.census1395 ? fa(p.population.census1395.pop) : '—'} />
            {p.population.latestEstimate && <Row k={`برآورد ${p.population.latestEstimate.year}`} v={fa(p.population.latestEstimate.pop)} />}
            <Row k="تراکم (نفر در کیلومتر مربع)" v={fa(p.population.densityPerKm2)} />
            <Row k="سهم مردان" v={p.population.maleShare === null ? '—' : `${fa(p.population.maleShare * 100, 1)}٪`} />
            <Row k="بُعد خانوار" v={fa(p.population.householdSize, 2)} />
            <Row k="جمعیت محله‌ای ثبت‌شده" v={`${fa(p.neighborhoodPopCoverage.matched)} محله · ${p.neighborhoodPopCoverage.shareOfDistrict1395 === null ? '—' : `${fa(p.neighborhoodPopCoverage.shareOfDistrict1395 * 100)}٪ منطقه`}`} />
            {status.populationSource && <p className="pt-1 text-[10px] text-ink-400">جمعیت محلهٔ فعلی: {status.populationSource.source}{status.populationSource.year ? ` (${fa(status.populationSource.year)})` : ''}</p>}
          </div>
        )}
      </Card>

      <Card title="بازار مسکن و استطاعت" icon={<Building2 size={14} />}>
        {!p?.housing.latest ? <p className="text-[11px] text-ink-400">قیمت رسمی مسکن منطقه در دسترس نیست.</p> : (
          <div className="space-y-1.5 text-[11px]">
            <Row k={`قیمت هر متر (${p.housing.latest.period})`} v={`${fa(p.housing.latest.priceMRialPerM2 / 10, 1)} میلیون تومان`} />
            <Row k="رتبه در میان مناطق" v={`${fa(p.housing.latest.rank)} از ${fa(p.housing.latest.ofDistricts)} · ${fa(p.housing.latest.ratioToCity, 2)}× میانگین شهر`} />
            {p.housing.trend && <Row k={`تغییر ۱۲ ماهه (${p.housing.trend.from}→${p.housing.trend.to})`} v={`${fa(p.housing.trend.changePct, 1)}٪`} />}
            {p.housing.priceToIncomeYears && <Row k={`سال‌های درآمد برای خرید ${fa(p.housing.priceToIncomeYears.unitM2)} متر`} v={fa(p.housing.priceToIncomeYears.value, 1)} />}
            {p.housing.marketRentBurdenRef && <Row k="بار اجارهٔ بازار (مدل‌شده)" v={`${fa(p.housing.marketRentBurdenRef.value, 1)}٪ درآمد`} />}
            <Row k="بار مسکن در پیمایش محله (E4)" v={eco?.medianBurdenPct == null ? `— (${fa(eco?.burdenN ?? 0)} پاسخ)` : `${fa(eco.medianBurdenPct, 1)}٪ · ${fa(eco.burdenN)} پاسخ`} />
            {off.incomeBenchmark && <Row k={`معیار درآمد خانوار (${off.incomeBenchmark.month})`} v={`${fa(off.incomeBenchmark.monthlyMToman, 1)} میلیون تومان/ماه`} />}
            <Row k="میانهٔ درآمد در پیمایش (E1)" v={eco?.medianIncomeMToman == null ? '—' : `${fa(eco.medianIncomeMToman, 1)} میلیون تومان`} />
            <p className="pt-1 text-[10px] leading-5 text-ink-400">قیمت: بانک مرکزی؛ درآمد: هزینه‌ودرآمد خانوار مرکز آمار، تعدیل با تورم. این اعداد سطح منطقه‌اند و جای پیمایش محله را نمی‌گیرند.</p>
          </div>
        )}
      </Card>

      <Card title="بسته‌های دادهٔ رسمی" icon={<Database size={14} />}>
        <div className="space-y-2">
          {off.packs.map((pk) => (
            <div key={pk.id} className="rounded-xl border border-line/70 p-2 text-[11px] dark:border-wall-700">
              <div className="font-black text-ink-800 dark:text-slate-100">{pk.title}</div>
              <div className="mt-0.5 text-[10px] text-ink-500">{pk.indicator} · {fa(pk.rows)} ردیف · {pk.period} · {pk.source}</div>
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <span className="text-[10px] font-bold text-ink-600 dark:text-slate-300">{pk.batch ? BATCH_FA[pk.batch.status] ?? pk.batch.status : 'هنوز وارد نشده'}</span>
                {(!pk.batch || pk.batch.status === 'REJECTED') && (
                  <button type="button" className={ghostBtn} disabled={busy !== null} onClick={() => void stage(pk.id)}>
                    {busy === pk.id ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} ورود برای بازبینی
                  </button>
                )}
              </div>
            </div>
          ))}
          {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
          <p className="text-[10px] leading-5 text-ink-400">پس از ورود، مدیر باید دسته را در بخش «ورود داده» تأیید کند تا جمعیت محله‌ها در وزن‌دهی و نمونه‌گیری به کار رود.</p>
        </div>
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-2"><span className="text-ink-500">{k}</span><strong className="text-ink-800 dark:text-slate-100">{v}</strong></div>;
}
