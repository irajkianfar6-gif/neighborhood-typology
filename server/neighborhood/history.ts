/** تاریخچهٔ اجراهای هر محله (JSONL) برای روند، بازتولیدپذیری و تشخیص تغییر */
import fs from 'node:fs';
import path from 'node:path';
import { serverDataDir } from '../paths';

export interface RunRecord {
  runAt: string; neighborhoodId: string; level: string; fingerprint: string;
  versions: Record<string, string>;
  scores: Record<string, { raw: number | null; score: number | null; reliability: number; tier: string }>;
  triad?: { Q: number; T: number; R: number } | null;
  engineRunId?: string | null;
}

function file(id: string): string {
  const dir = path.join(serverDataDir(), 'neighborhood-runs');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${id.replace(/[^\w.-]/g, '_')}.jsonl`);
}
export function appendRun(rec: RunRecord): void { fs.appendFileSync(file(rec.neighborhoodId), `${JSON.stringify(rec)}\n`); }
export function loadRuns(id: string, limit = 50): RunRecord[] {
  const f = file(id);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).slice(-limit).map((l) => JSON.parse(l) as RunRecord);
}

/** تغییرات بیش از ۲ انحراف معیار نسبت به اجراهای قبلی → بازبینی operator */
export function detectAnomalies(id: string, current: RunRecord['scores']): Array<{ code: string; previousMean: number; current: number; z: number }> {
  const runs = loadRuns(id, 20);
  const out: Array<{ code: string; previousMean: number; current: number; z: number }> = [];
  for (const [code, v] of Object.entries(current)) {
    if (v.raw === null) continue;
    const prev = runs.map((r) => r.scores[code]?.raw).filter((x): x is number => typeof x === 'number');
    if (prev.length < 3) continue;
    const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
    const sd = Math.sqrt(prev.reduce((a, b) => a + (b - mean) ** 2, 0) / (prev.length - 1));
    if (sd === 0) { if (v.raw !== mean) out.push({ code, previousMean: mean, current: v.raw, z: Infinity }); continue; }
    const z = (v.raw - mean) / sd;
    if (Math.abs(z) > 2) out.push({ code, previousMean: Math.round(mean * 10) / 10, current: v.raw, z: Math.round(z * 10) / 10 });
  }
  return out;
}
