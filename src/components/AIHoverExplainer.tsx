// ============================================================
// دستیار هوور-هلپر هوش مصنوعی (حکیم)
// هر جا کاربر نشانگر را بیش از ۵ ثانیه ثابت نگه دارد، یک ایکون
// «؟» کنار نشانگر ظاهر می‌شود؛ با کلیک، یک پاپ‌آپ حرفه‌ای و
// مینیمال باز می‌شود و حکیم همان واژه/بخش را توضیح می‌دهد.
// ============================================================
import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Sparkles, X, HelpCircle, RefreshCw, Bot } from 'lucide-react';
import { chatWithAI } from '../lib/aiService';
import { buildExplainMessages, localExplainFallback } from '../lib/aiExplain';
import { getHakimGrounding } from '../lib/hakimGrounding';
import { computePlacement, bestVerticalRoom, MIN_VERTICAL_ROOM } from '../lib/popupPlacement';

const HOLD_MS = 5000; // ثانیه‌های ثابت‌ماندن نشانگر
const STILL_PX = 5; // آستانهٔ «بی‌حرکتی» نشانگر
const MAX_TEXT = 200;

// منطق جای‌گذاری (مرکز-اول، دور از منشأ، همیشه کامل داخل viewport) در
// src/lib/popupPlacement.ts قرار دارد.

interface Target {
  subject: string;
  context: string;
  root: Element;
}

interface PopupState {
  subject: string;
  context: string;
  root: Element | null; // بخشِ مرجعِ در حال توضیح (برای دور ماندن از آن)
  x: number;
  y: number;
}

function cleanText(t: string | null | undefined): string {
  if (!t) return '';
  return t.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
}

function headingTextOf(node: Element): string {
  const h = node.querySelector('h1, h2, h3, h4, h5, h6');
  return h ? cleanText(h.textContent) : '';
}

function headingUp(el: Element): string {
  let node: Element | null = el;
  for (let i = 0; i < 6 && node; i++, node = node.parentElement) {
    const t = headingTextOf(node);
    if (t) return t;
  }
  return '';
}

/** یافتن ریشهٔ معنادار: اول عنصر دارای data-ai-explain، بعد خود عنصر + نزدیک‌ترین عنوان */
function resolveTarget(el: Element): Target {
  let node: Element | null = el;
  for (let i = 0; i < 5 && node && node !== document.body; i++, node = node.parentElement) {
    const explain = node.getAttribute ? node.getAttribute('data-ai-explain') : null;
    if (explain) {
      return {
        subject: explain,
        context: node.getAttribute('data-ai-context') || headingTextOf(node) || headingUp(node),
        root: node,
      };
    }
  }
  const subject = cleanText(el.textContent);
  return { subject: subject || 'این بخش', context: headingUp(el), root: el };
}

function isExcluded(el: Element | null): boolean {
  if (!el) return true;
  if (el.closest('[data-ai-hover-root]')) return true; // داخل خود هلپر نباشیم
  if (el.closest('[data-ai-hover="off"]')) return true;
  if (el.closest('input, textarea, select, [contenteditable="true"], script, style')) return true;
  const tag = el.tagName;
  return tag === 'BODY' || tag === 'HTML';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** رندر سبک متن مدل: **پررنگ** و لیست‌ها */
function renderAnswer(text: string) {
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  return (
    <div className="flex flex-col gap-1.5">
      {lines.map((line, i) => {
        let body = escapeHtml(line);
        if (body.startsWith('- ') || body.startsWith('• ') || body.startsWith('* ')) {
          body = body.replace(/^[-•*]\s+/, '');
          return (
            <div key={i} className="flex gap-1.5 text-[10.5px] leading-relaxed text-ink-600">
              <span className="text-brand-700 mt-0.5 shrink-0">•</span>
              <span dangerouslySetInnerHTML={{ __html: body.replace(/\*\*(.+?)\*\*/g, '<strong class="text-ink-900">$1</strong>') }} />
            </div>
          );
        }
        body = body.replace(/^#+\s*/, '');
        return (
          <p key={i} className="text-[10.5px] leading-relaxed text-ink-600" dir="rtl">
            <span dangerouslySetInnerHTML={{ __html: body.replace(/\*\*(.+?)\*\*/g, '<strong class="text-ink-900">$1</strong>') }} />
          </p>
        );
      })}
    </div>
  );
}

export default function AIHoverExplainer() {
  const [hint, setHint] = useState<{ x: number; y: number; target: Target } | null>(null);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLocal, setIsLocal] = useState(false);

  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [maxBodyH, setMaxBodyH] = useState<number>(() => Math.max(180, window.innerHeight - 168));
  const popupRef = useRef<HTMLDivElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const timer = useRef<number | null>(null);
  const lastMove = useRef<{ x: number; y: number }>({ x: -999, y: -999 });
  const currentRoot = useRef<Element | null>(null);

  const clearTimer = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  // ── واکشی توضیح از حکیم (بر پایهٔ الگوریتم مرجع، با جایگزین محلی) ──
  const runExplain = useCallback(
    async (subject: string, context: string) => {
      setLoading(true);
      setError(null);
      setAnswer(null);
      setIsLocal(false);
      try {
        const grounding = await getHakimGrounding();
        const { system, user } = buildExplainMessages(subject, context, grounding);
        const text = await chatWithAI(
          [{ role: 'user', content: user }],
          { system, maxTokens: 900 },
        );
        setAnswer(text);
      } catch (e) {
        const local = localExplainFallback(subject);
        if (local) {
          setIsLocal(true);
          setAnswer(local);
        } else {
          setError(e instanceof Error ? e.message : 'خطای نامشخص در اتصال به سرویس هوش مصنوعی');
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const openPopup = useCallback(
    (target: Target, x: number, y: number) => {
      setHint(null);
      setPopup({ subject: target.subject, context: target.context, root: target.root, x, y });
      void runExplain(target.subject, target.context);
    },
    [runExplain],
  );

  // اندازهٔ واقعی پاپ‌آپ را می‌سنجیم و جای‌گذاری را قبل از paint نهایی می‌کنیم
  const applyPlacement = useCallback(() => {
    const el = popupRef.current;
    if (!el || !popup) return;
    const w = el.offsetWidth || 380;
    const h = el.offsetHeight || 360;
    let targetRect: DOMRect | null = null;
    if (popup.root && typeof (popup.root as Element).getBoundingClientRect === 'function') {
      const r = (popup.root as Element).getBoundingClientRect();
      if (r.width > 0 && r.height > 0) targetRect = r;
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const next = computePlacement(targetRect, w, h, vw, vh);
    setPos(next);

    // اگر هیچ جای کامل‌اندازه‌ای نبود (پاپ‌آپ بلندتر از همهٔ فضاها)، بدنه را
    // کوچک می‌کنیم تا در بزرگ‌ترین فضای آزاد زیر/بالای منشأ جا بگیرد و هرگز
    // روی بخشِ موردِ توضیح نیفتد
    if (next.fallback && targetRect) {
      const room = bestVerticalRoom(targetRect, vh);
      if (room >= MIN_VERTICAL_ROOM) {
        const overhead = Math.max(0, h - (bodyRef.current ? bodyRef.current.offsetHeight : 0));
        const bodyMax = Math.max(140, Math.floor(room - overhead - 4));
        setMaxBodyH((prev) => (bodyMax < prev ? bodyMax : prev));
      }
    }

    // رکورد تصمیم جای‌گذاری برای پایش/رفع‌اشکال
    el.setAttribute(
      'data-placement',
      JSON.stringify({ left: Math.round(next.left), top: Math.round(next.top), w, h, vw, vh, target: targetRect ? [Math.round(targetRect.left), Math.round(targetRect.top), Math.round(targetRect.width), Math.round(targetRect.height)] : null, fallback: next.fallback }),
    );
  }, [popup]);

  // قبل از هر paint: موقعیت اولیه + هر بار که اندازهٔ محتوا تغییر می‌کند (بارگذاری/پاسخ/خطا)
  useLayoutEffect(() => {
    if (!popup) {
      setPos(null);
      setMaxBodyH(Math.max(180, window.innerHeight - 168));
      return;
    }
    applyPlacement();
    // اگر محتوا هنوز رندر نشده، یک پاس بعد از آن هم بگیر
    const raf = window.requestAnimationFrame(() => applyPlacement());
    return () => window.cancelAnimationFrame(raf);
  }, [popup, loading, answer, error, maxBodyH, applyPlacement]);

  // هنگام تغییر اندازه/اسکرول صفحه، جای‌گذاری را بازنگری کن تا همیشه کامل و دور از منشأ بماند
  useEffect(() => {
    if (!popup) return;
    const onViewportChange = () => applyPlacement();
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    return () => {
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
    };
  }, [popup, applyPlacement]);

  // ── شنونده‌های سراسری ────────────────────────────────────
  useEffect(() => {
    const onMouseOver = (e: MouseEvent) => {
      if (popup) return;
      const el = e.target as Element | null;
      if (isExcluded(el)) {
        currentRoot.current = null;
        clearTimer();
        return;
      }
      const target = resolveTarget(el as Element);
      // اگر هنوز روی همان «ریشه» هستیم، تایمر را بازنشانی نکن (جابه‌جایی بین فرزندان)
      if (currentRoot.current === target.root) return;
      currentRoot.current = target.root;
      clearTimer();
      timer.current = window.setTimeout(() => {
        const now = lastMove.current;
        if (currentRoot.current === target.root && !popup) {
          setHint({ x: now.x, y: now.y, target });
        }
      }, HOLD_MS);
    };

    const onMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - lastMove.current.x;
      const dy = e.clientY - lastMove.current.y;
      const moved = Math.hypot(dx, dy);
      if (moved > STILL_PX) {
        lastMove.current = { x: e.clientX, y: e.clientY };
        clearTimer();
        if (currentRoot.current && !popup) {
          timer.current = window.setTimeout(() => {
            if (currentRoot.current && !popup) {
              const el = currentRoot.current as Element;
              const t = resolveTarget(el);
              setHint({ x: e.clientX, y: e.clientY, target: t });
            }
          }, HOLD_MS);
        }
      }
    };

    const onMouseOut = (e: MouseEvent) => {
      if (hint) return; // پس از ظاهر شدن «؟»، تا کلیک/خروج صریح ثابت می‌ماند
      if (!currentRoot.current) return;
      const root = currentRoot.current;
      const related = e.relatedTarget as Node | null;
      if (related && root.contains(related)) return; // جابه‌جایی بین فرزندان همان ریشه
      currentRoot.current = null;
      clearTimer();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPopup(null);
    };

    const onDocClick = (e: MouseEvent) => {
      const t = e.target as Element | null;
      const isEl = t != null && typeof (t as Element).closest === 'function';
      if (popup) {
        if (!isEl || !t.closest('[data-ai-popup-root]')) setPopup(null);
        return;
      }
      if (hint && (!isEl || !t.closest('[data-ai-hover-root]'))) setHint(null);
    };

    window.addEventListener('mouseover', onMouseOver);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseout', onMouseOut);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('click', onDocClick);
    return () => {
      window.removeEventListener('mouseover', onMouseOver);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseout', onMouseOut);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('click', onDocClick);
      clearTimer();
    };
  }, [popup, hint, clearTimer, openPopup]);

  // نکتهٔ مهم: پاپ‌آپ و ایکون باید از طریق پورتال به body بروند، چون اجدادِ این
  // کامپوننت (تب صفحه) transform دارند و باعث می‌شوند fixed نسبت به آن‌ها باشد نه
  // viewport — در نتیجه پاپ‌آپ جابه‌جا/بریده می‌شد. پورتال به body این را حل می‌کند.
  return createPortal(
    <>
      {/* ایکون «؟» پس از ۵ ثانیه ثابت‌ماندن */}
      {hint && !popup && (
        <div
          data-ai-hover-root
          className="fixed z-[100] pointer-events-none"
          style={{ left: Math.min(hint.x + 14, window.innerWidth - 52), top: Math.min(hint.y + 14, window.innerHeight - 52) }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              openPopup(hint.target, hint.x, hint.y);
            }}
            className="pointer-events-auto w-9 h-9 rounded-full bg-brand-800 text-signal-400 border border-signal-400/60 shadow-[0_6px_18px_rgba(29,89,64,0.35)] flex items-center justify-center cursor-pointer hover:scale-110 hover:bg-brand-700 active:scale-95 transition-all animate-fade-in"
            title="توضیح هوش مصنوعی این بخش"
          >
            <HelpCircle size={17} strokeWidth={2.4} />
          </button>
        </div>
      )}

      {/* پاپ‌آپ توضیح — فضای میانیِ قابل‌مشاهده، همیشه کامل، بالای همهٔ بخش‌ها */}
      {popup && (
        <div
          ref={popupRef}
          data-ai-popup-root
          data-ai-hover-root
          className="fixed z-[120] w-[min(92vw,380px)]"
          style={
            pos
              ? { left: pos.left, top: pos.top }
              : { left: 0, top: 0, opacity: 0, pointerEvents: 'none' } // یک فریم قبل از اندازه‌گیری
          }
        >
          <div className="relative rounded-2xl border border-line bg-surface shadow-[var(--shadow-pop)] overflow-hidden animate-fade-in">
            {/* سربرگ */}
            <div className="flex items-start justify-between gap-2 px-4 py-3 bg-gradient-to-l from-brand-900 to-brand-800 text-white">
              <div className="flex items-start gap-2 min-w-0">
                <div className="size-7 rounded-full bg-signal-400/20 border border-signal-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Sparkles size={13} className="text-signal-400" />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-black flex items-center gap-1">
                    توضیح هوش مصنوعی حکیم
                    <span className="text-[7.5px] font-bold bg-white/10 border border-white/20 rounded-full px-1.5 py-0.5">برخط</span>
                  </span>
                  <span className="text-[9.5px] font-bold text-brand-100/90 truncate mt-0.5" title={popup.subject}>{popup.subject}</span>
                </div>
              </div>
              <button
                onClick={() => setPopup(null)}
                className="p-1 -m-1 rounded-lg hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                title="بستن"
              >
                <X size={14} />
              </button>
            </div>

            {/* بدنه */}
            <div ref={bodyRef} className="px-4 py-3 overflow-y-auto [scrollbar-width:thin]" style={{ maxHeight: maxBodyH }}>
              {loading && (
                <div className="flex flex-col items-center gap-2.5 py-6">
                  <Bot size={22} className="text-brand-700 animate-pulse" />
                  <p className="text-[10px] font-black text-ink-500">حکیم در حال تحلیل این بخش است…</p>
                </div>
              )}
              {!loading && error && (
                <div className="flex flex-col items-center gap-2.5 py-4 text-center">
                  <p className="text-[10px] font-bold text-danger leading-relaxed">{error}</p>
                  <button
                    onClick={() => void runExplain(popup.subject, popup.context)}
                    className="flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-[9.5px] font-black text-ink-600 hover:border-brand-300 hover:text-brand-800 transition-all cursor-pointer"
                  >
                    <RefreshCw size={11} /> تلاش دوباره
                  </button>
                </div>
              )}
              {!loading && answer && (
                <>
                  {renderAnswer(answer)}
                  {isLocal && (
                    <p className="mt-3 text-[8.5px] font-bold text-amber-700 bg-amber-50 border border-amber-300/50 rounded-lg px-2 py-1.5">
                      ⚠ سرویس برخط در دسترس نبود؛ این پاسخ از دانش محلی سامانه ارائه شد.
                    </p>
                  )}
                </>
              )}
            </div>

            {/* پابرگ */}
            <div className="px-4 py-2.5 border-t border-line flex items-center justify-between gap-2 bg-paper/50">
              <button
                onClick={() => void runExplain(popup.subject, popup.context)}
                disabled={loading}
                className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[9px] font-black text-ink-500 hover:text-brand-800 hover:border-brand-300 transition-all cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={10} className={loading ? 'animate-spin' : ''} /> پرسش دوباره
              </button>
              <span className="text-[8px] font-bold text-ink-400">Esc یا کلیک بیرون = بستن</span>
            </div>
          </div>
        </div>
      )}
    </>,
    document.body,
  );
}
