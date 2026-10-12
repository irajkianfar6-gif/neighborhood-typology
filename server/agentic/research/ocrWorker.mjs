// فرایند جدا برای OCR (tesseract.js ناهمگام است؛ استخراج سند همگام می‌ماند).
// ورودی: argv = [langPath, cachePath, ...imagePaths] ؛ خروجی: JSON روی stdout
import { createWorker } from 'tesseract.js';

const [langPath, cachePath, ...images] = process.argv.slice(2);
const out = [];
try {
  const worker = await createWorker(['fas', 'eng'], 1, { langPath, cachePath, gzip: true, logger: () => {}, errorHandler: () => {} });
  await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' });
  for (let i = 0; i < images.length; i++) {
    const { data } = await worker.recognize(images[i]);
    out.push({ page: i + 1, text: data.text ?? '', confidence: Math.round(data.confidence ?? 0) });
  }
  await worker.terminate();
  process.stdout.write(JSON.stringify({ ok: true, pages: out }));
  process.exit(0);
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  process.exit(1);
}
