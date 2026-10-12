// فرایند جدا برای OCR (tesseract.js ناهمگام است؛ استخراج سند همگام می‌ماند).
// OCR-v2: پیش‌پردازش تصویر (خاکستری، بزرگ‌نمایی، یکنواخت‌سازی کنتراست)، گذر اصلی fas+eng با جعبهٔ واژه‌ها،
// و گذر دوم فقط‌رقم برای راستی‌آزمایی عددها. ورودی: argv = [langPath, cachePath, ...imagePaths] ؛ خروجی: JSON روی stdout
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorker } from 'tesseract.js';

const [langPath, cachePath, ...images] = process.argv.slice(2);
const DIGITS = '0123456789۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩.,٫٬/%-';
const MIN_WIDTH = 2000;

async function preprocess(file) {
  // ImageMagick (اگر روی سرور باشد): خاکستری، بزرگ‌نمایی تا حدود ۲۰۰۰ پیکسل پهنا، یکنواخت‌سازی کنتراست، تیزکردن ملایم
  const out = path.join(os.tmpdir(), `ara-ocrpre-${process.pid}-${Math.random().toString(36).slice(2)}.png`);
  try {
    const width = Number(execFileSync('magick', ['identify', '-format', '%w', `${file}[0]`], { timeout: 30_000 }).toString().trim());
    const scale = width && width < MIN_WIDTH ? Math.min(3, MIN_WIDTH / width) : 1;
    const args = [`${file}[0]`, '-auto-orient', '-background', 'white', '-flatten', '-colorspace', 'Gray'];
    if (scale > 1) args.push('-filter', 'Lanczos', '-resize', `${Math.round(scale * 100)}%`);
    args.push('-normalize', '-sharpen', '0x0.8', out);
    execFileSync('magick', args, { timeout: 60_000 });
    return { file: out, scale, steps: ['grayscale', ...(scale > 1 ? [`upscale x${scale.toFixed(2)}`] : []), 'normalize', 'sharpen'] };
  } catch { fs.rmSync(out, { force: true }); return { file, scale: 1, steps: [] }; }
}

function tsvWords(tsv, scale) {
  const words = [];
  for (const line of String(tsv ?? '').split('\n')) {
    const f = line.split('\t');
    if (f[0] !== '5' || f.length < 12) continue;
    const text = f.slice(11).join('\t').trim();
    if (!text) continue;
    const [x, y, w, h] = [6, 7, 8, 9].map((i) => Number(f[i]) / scale);
    words.push({ x0: x, x1: x + w, y: y + h / 2, h, text, conf: Math.round(Number(f[10])) });
  }
  return words;
}

const out = [];
const tmp = [];
try {
  const worker = await createWorker(['fas', 'eng'], 1, { langPath, cachePath, gzip: true, logger: () => {}, errorHandler: () => {} });
  for (let i = 0; i < images.length; i++) {
    const pre = await preprocess(images[i]);
    if (pre.file !== images[i]) tmp.push(pre.file);
    await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1', tessedit_char_whitelist: '' });
    const { data } = await worker.recognize(pre.file, {}, { text: true, tsv: true });
    const words = tsvWords(data.tsv, pre.scale);
    // گذر فقط‌رقم: همان صفحه با فهرست سفید رقم‌ها؛ برای هم‌سنجی عددهای گذر اصلی به کار می‌رود
    let digitWords = [];
    if (words.some((w) => /[0-9۰-۹٠-٩]/.test(w.text))) {
      await worker.setParameters({ tessedit_pageseg_mode: '11', tessedit_char_whitelist: DIGITS });
      const d2 = await worker.recognize(pre.file, {}, { text: false, tsv: true });
      digitWords = tsvWords(d2.data.tsv, pre.scale).filter((w) => /[0-9۰-۹٠-٩]/.test(w.text));
    }
    out.push({ page: i + 1, text: data.text ?? '', confidence: Math.round(data.confidence ?? 0), words, digitWords, preprocessing: pre.steps });
  }
  await worker.terminate();
  process.stdout.write(JSON.stringify({ ok: true, pages: out }));
  process.exitCode = 0;
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exitCode = 1;
} finally {
  for (const f of tmp) fs.rmSync(f, { force: true });
}
process.exit(process.exitCode ?? 0);
