import { useState, useRef, useEffect } from 'react';
import { Bot, MessageCircle, Send, User } from 'lucide-react';

interface Message { role: 'user' | 'ai'; text: string; }

const MODEL = import.meta.env.VITE_ANTHROPIC_MODEL || 'claude-opus-4-8';

export default function AIDecisionAdvisor({ neighborhoodName }: { neighborhoodName?: string }) {
  const [messages, setMessages] = useState<Message[]>([{
    role: 'ai',
    text: `سلام؛ من مشاور تصمیم‌یار محله هستم.\n${neighborhoodName ? `پرونده فعال: ${neighborhoodName}\n` : ''}درباره تشخیص، گلوگاه یا اقدام پیشنهادی سؤال کنید.`,
  }]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const send = async () => {
    if (!input.trim() || loading) return;
    const value = input.trim();
    setInput('');
    setError(null);
    setMessages(prev => [...prev, { role: 'user', text: value }]);
    setLoading(true);

    // Build conversation history for context
    const apiMessages = messages
      .filter(m => m.role === 'ai' || m.role === 'user')
      .map(m => ({ role: m.role === 'ai' ? 'assistant' as const : 'user' as const, content: m.text }));
    apiMessages.push({ role: 'user', content: value });

    try {
      const res = await fetch('/api/anthropic/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 600,
          system: neighborhoodName
            ? `شما مشاور تصمیم‌یار محله "${neighborhoodName}" هستید. بر اساس داده‌های محله و الگوریتم تحلیل کیفیت زندگی پاسخ دهید. فقط از داده‌های ارائه‌شده استفاده کنید و عددسازی نکنید.`
            : 'شما مشاور تصمیم‌یار محله هستید. بر اساس الگوریتم تحلیل کیفیت زندگی پاسخ دهید. فقط از داده‌های ارائه‌شده استفاده کنید و عددسازی نکنید.',
          messages: apiMessages,
        }),
      });

      if (!res.ok) {
        const errBody = await res.text();
        console.error('AI API error:', res.status, errBody);
        setMessages(prev => [...prev, { role: 'ai', text: `خطا از سمت سرور (${res.status}). لطفاً دوباره تلاش کنید.` }]);
        setError(`HTTP ${res.status}`);
      } else {
        const data = await res.json() as { content?: Array<{ text?: string }>; error?: string };
        const text = data.content?.[0]?.text;
        if (text) {
          setMessages(prev => [...prev, { role: 'ai', text }]);
        } else {
          setMessages(prev => [...prev, { role: 'ai', text: 'پاسخی از مدل دریافت نشد. لطفاً دوباره تلاش کنید.' }]);
        }
      }
    } catch (err) {
      console.error('AI fetch error:', err);
      setMessages(prev => [...prev, { role: 'ai', text: 'خطا در اتصال به سرویس هوش مصنوعی. اتصال شبکه را بررسی کنید.' }]);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="icon-tile"><MessageCircle size={17} /></div>
        <div>
          <h3 className="text-base font-black text-ink-900 dark:text-white">مشاور هوشمند</h3>
          <p className="mt-1 text-[10px] text-ink-400 dark:text-slate-500">
            متصل به {MODEL} از طریق api.justwoker.icu
          </p>
        </div>
      </div>

      <div className="max-h-[430px] space-y-3 overflow-y-auto rounded-2xl border border-line bg-paper p-4 dark:border-wall-700 dark:bg-wall-850" aria-live="polite">
        {messages.map((message, index) => (
          <div key={index} className={`flex gap-2 ${message.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <span className={`flex size-8 shrink-0 items-center justify-center rounded-xl ${message.role === 'ai' ? 'bg-brand-800 text-white dark:bg-signal-400 dark:text-wall-950' : 'bg-line text-ink-500 dark:bg-wall-700 dark:text-slate-300'}`}>
              {message.role === 'ai' ? <Bot size={15} /> : <User size={15} />}
            </span>
            <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs font-medium leading-6 ${message.role === 'ai' ? 'bg-surface text-ink-700 dark:bg-wall-800 dark:text-slate-200' : 'bg-brand-100 text-brand-900 dark:bg-wall-700 dark:text-signal-300'}`}>
              <p className="whitespace-pre-wrap">{message.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-brand-800 text-white">
              <Bot size={15} />
            </span>
            <span className="rounded-2xl bg-surface px-3 py-2 text-xs text-ink-400 dark:bg-wall-800 dark:text-slate-400">
              در حال پردازش…
            </span>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {error && (
        <p className="text-[10px] text-red-500 dark:text-red-400">خطا: {error}</p>
      )}

      <div className="flex gap-2">
        <label htmlFor="advisor-input" className="sr-only">پرسش از مشاور هوشمند</label>
        <input
          id="advisor-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send()}
          placeholder="مثلاً چرا توان تبدیل پایین است؟"
          className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-800/10 dark:border-wall-700 dark:bg-wall-800 dark:text-white"
        />
        <button
          type="button"
          onClick={send}
          disabled={!input.trim() || loading}
          aria-label="ارسال پرسش"
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-800 text-white disabled:opacity-40 dark:bg-signal-400 dark:text-wall-950"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  );
}
