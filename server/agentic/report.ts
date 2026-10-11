/** عامل گزارش (A13) — گزارش دولایهٔ قطعی به فارسی از کارت تصمیم؛ هیچ عددی خارج از کارت نوشته نمی‌شود */
import type { CriticReport } from './critic';
import type { CardResult } from './state';

const LEVEL_FA: Record<string, string> = { PUBLISHABLE: 'قابل انتشار', PROVISIONAL: 'موقت', INSUFFICIENT: 'ناکافی' };
const CAP_FA: Record<string, string> = { H: 'انسانی', S: 'اجتماعی', E: 'اقتصادی', P: 'کالبدی', N: 'طبیعی', C: 'فرهنگی', G: 'نهادی', R: 'شبکه‌ای' };
const fmt = (x: number | null | undefined) => (x === null || x === undefined ? '—' : String(Math.round(x * 10) / 10));

export function renderReport(r: CardResult, critic: CriticReport | null, layer: 'analytical' | 'official'): { layer: string; allowed: boolean; markdown: string; reason?: string } {
  const c = r.card;
  if (layer === 'official' && !(critic?.officialPublicationAllowed)) {
    return { layer, allowed: false, markdown: '', reason: c.publication.level !== 'PUBLISHABLE' ? `سطح کارت «${LEVEL_FA[c.publication.level] ?? c.publication.level}» است؛ لایهٔ رسمی فقط برای کارت قابل انتشار` : 'نقاد انتشار رسمی را مجاز نکرده است' };
  }
  const L: string[] = [];
  L.push(`# گزارش ${layer === 'official' ? 'رسمی' : 'تحلیلی'} — ${c.neighborhood.nameFa} (${c.neighborhood.cityFa})`);
  L.push(`سطح کارت: **${LEVEL_FA[c.publication.level] ?? c.publication.level}** · تولید: ${c.generatedAt} · اثرانگشت: \`${c.fingerprint}\``);
  if (c.publication.reasons.length) L.push(`\n> ${c.publication.reasons.join(' · ')}`);
  L.push('\n## سرمایه‌ها');
  L.push('| سرمایه | امتیاز | سطح | شاخص‌های به‌کاررفته |\n| --- | --- | --- | --- |');
  for (const k of c.capitals) L.push(`| ${CAP_FA[k.capital] ?? k.capital} | ${fmt(k.score)} | ${LEVEL_FA[k.level] ?? k.level} | ${k.indicatorsUsed.join('، ') || '—'} |`);
  if (c.engine) {
    L.push('\n## تشخیص');
    L.push(`- گلوگاه: سرمایهٔ ${CAP_FA[c.engine.bottleneck.capital] ?? c.engine.bottleneck.capital}، گذار ${c.engine.bottleneck.transition.join(' → ')}`);
    if (c.engine.qualityVerdict) L.push(`- سه‌گانهٔ کیفیت: Q=${fmt(c.engine.qualityVerdict.Q)}، T=${fmt(c.engine.qualityVerdict.T)}، R=${fmt(c.engine.qualityVerdict.R)}`);
    L.push(`- سطح علّی: ${c.engine.causalLevel}`);
    for (const h of c.engine.hypotheses.slice(0, 5)) L.push(`- فرضیه (${h.evidenceStatus}): ${h.hypothesis}`);
  }
  if (c.localLayers?.findings.length) {
    L.push('\n## یافته‌های لایه‌های محله‌ای');
    for (const f of c.localLayers.findings) L.push(`- [${f.severity}/${f.confidence}] ${f.title} — ${f.evidence.join('؛ ')}`);
  }
  const ivs = [...(c.engine?.interventions ?? []).slice(0, 5).map((i) => `${i.name} (${i.targetCapital})`), ...(c.localLayers?.prescriptions ?? []).slice(0, 5).map((p) => `${p.name} [${p.libraryId}] — شاخص پایش: ${p.kpi}`)];
  if (ivs.length) { L.push('\n## تجویز (پیشنهاد؛ نیازمند تصویب کارشناس)'); ivs.forEach((x, i) => L.push(`${i + 1}. ${x}`)); }
  if (c.abstentions.length) { L.push('\n## امتناع‌ها'); c.abstentions.forEach((a) => L.push(`- ${a.section}: ${a.reason}`)); }
  if (c.whatWouldChangeThis.length) { L.push('\n## چه داده‌ای این حکم را تغییر می‌دهد'); c.whatWouldChangeThis.slice(0, 10).forEach((m) => L.push(`- ${m.code} ${m.name}: ${m.nextAction} (مسئول: ${m.owner})`)); }
  if (critic) {
    L.push(`\n## بازبینی نقاد (${critic.version}): ${critic.verdict}`);
    critic.checks.filter((x) => x.status !== 'pass').forEach((x) => L.push(`- ${x.status === 'fail' ? '⛔' : '⚠️'} ${x.title}: ${x.detail}`));
  }
  L.push('\n## منابع شاخص‌ها');
  for (const i of c.indicators.filter((x) => x.score !== null)) L.push(`- ${i.code} ${i.name}: ${fmt(i.raw)} ${i.unit} — ${i.source} (${i.tier}، اعتبار ${fmt(i.reliability)})`);
  L.push(`\nکلید بازتولید: ${Object.entries(c.reproducibilityKey).map(([k, v]) => `${k}=${v}`).join(' · ')}`);
  return { layer, allowed: true, markdown: L.join('\n') };
}
