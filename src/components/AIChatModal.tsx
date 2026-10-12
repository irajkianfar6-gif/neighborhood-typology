import { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, X, Sparkles, HelpCircle } from 'lucide-react';
import { ChatMessage } from '../types';
import { chatWithAI } from '../lib/aiService';
import { getHakimGrounding, sciDigestForChat, type HakimGrounding } from '../lib/hakimGrounding';
import { getArchive, recordEvent } from '../lib/archiveDB';

interface AIChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  totalBalance: number;
  totalExpenses: number;
}  const buildSystemPrompt = (totalBalance: number, totalExpenses: number, grounding?: HakimGrounding) =>
    `تو «حکیم» هستی، دستیار هوشمند تصمیم‌گیری و حکمرانی کشور در سامانه آرا (ISGP). به زبان فارسی پاسخ بده؛ مختصر، دقیق، ساختارمند و با لحن رسمی حکومتی.
داده‌های زنده خزانه متمرکز ملی در دسترس توست:
- مجموع تخصیص‌های پرداخت‌شده: ${totalExpenses.toLocaleString('fa-IR')} میلیون دلار
- کل ظرفیت فعال و نقدینگی مصوب خزانه: ${totalBalance.toLocaleString('fa-IR')} میلیون دلار
از این اعداد برای پاسخ به پرسش‌های بودجه و تراز استفاده کن. اگر داده کافی نداری، صادقانه بگو و حدس بی‌پایه نزن.

[الگوریتم مرجع گونه‌بندی محلات — برای پرسش‌های مرتبط با گونه‌شناسی، پایداری محلات و شاخص‌های آن]
${grounding?.algorithmSpec || ''}

${grounding?.catalogDigestForChat || ''}

${sciDigestForChat(grounding, 'light')}`;

export default function AIChatModal({ isOpen, onClose, totalBalance, totalExpenses }: AIChatModalProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      sender: 'assistant',
      text: 'سلام! من «حکیم» دستیار هوشمند تصمیم‌گیری و حکمرانی کشور در سامانه آرا هستم. چطور می‌توانم در پایش بودجه کلان، شبیه‌سازی سناریوهای اقتصادی، گونه‌شناسی محلات و ارزیابی پیشرفت فیزیکی کلان‌پروژه‌های ملی به شما کمک کنم؟',
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInput] = useState('');
  const [isThinking, setIsThinking] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const suggestedQuestions = [
    { text: 'تحلیل الگوی غالب و سلول‌های مکعب پایلوت نی‌ریز', key: 'neyriz' },
    { text: 'وضعیت تراز بودجه خزانه ملی چطور است؟', key: 'status' },
    { text: 'مفهوم ستون سرمایه معنوی-اخلاقی چیست؟', key: 'rsci' },
    { text: 'سناریوی مدیریت ناترازی موقت برق و انرژی کشور', key: 'scenario' }
  ];

  // پاسخ پیش‌فرض شبیه‌ساز (فقط در صورت نبود کلید API یا خطای سرویس زنده)
  const buildMockReply = (text: string): string => {
    const t = text.toLowerCase();

    if (t.includes('نی‌ریز') || t.includes('مکعب') || t.includes('neyriz') || t.includes('پایلوت')) {
      return `با استناد به مستندات **پایلوت اجرایی شهرستان نی‌ریز (کد IR-FAR-NEY)**، مشخصات زیر در شبیه‌ساز آرا پایش گردیده است:
      
۱. **الگوی توسعه غالب:** شهرستان نی‌ریز در رده **«نیاز اشباع‌شده با حساسیت اکولوژیک»** قرار دارد. دلیل اصلی آن ناترازی شدید هیدرولوژیک تالاب بختگان و افت آب‌های زیرزمینی به میزان ۰.۹۲- متر در سال است.
۲. **مهم‌ترین سلول نیاز (C13):** نرخ بیکاری جوانان (۲۶.۳٪) و سرانه آب زیرزمینی بسیار بحرانی (۴۸۰ مترمکعب سالانه).
۳. **پروژه کلیدی در بعد کنش (C31):** طرح اولویت‌دار **P-01 (خوشه صنعتی فرو-کروم قطب فرومتالورژی)** با سرمایه ۴,۵۰۰ میلیارد تومان و ایجاد ۶۸۰ شغل مستقیم با نمره انطباق عالی **۰.۸۲** پایش شده است.

توصیه پلتفرم آرا: تمرکز فوری بر بسته‌های غیر آب‌بر از جمله توسعه گلیم‌بافی صادراتی (پروژه P-03) و مزارع پسته شور-تحمل (پروژه P-04).`;
    }
    if (t.includes('معنوی') || t.includes('rsci') || t.includes('سرمایه') || t.includes('اخلاقی')) {
      return `در الگوی اسلامی-ایرانی پیشرفت پلتفرم آرا، **«سرمایه معنوی-اخلاقی» (RSCI)** به عنوان ستون پایش مستقل (کد CT1) با وزن اولیه **۱۲٪** در نظر گرفته می‌شود:
      
- **شاخص‌های فعال:** تراکم مساجد فعال (SP-01)، میزان وقف سالانه، نرخ صلح و سازش پرونده‌های قضایی (SP-16)، و سهم اوقاف در محرومیت‌زدایی.
- **امتیاز نی‌ریز:** در این سرفصل نی‌ریز موفق به کسب امتیاز خوب **۰.۷۲** شده است که به علت تراکم بالای موقوفات فعال و پیوند سنتی مذهبی در پشتکوه است.
- **کاربرد حاکمیت:** این سرمایه به عنوان قید سخت تصمیم‌گیری در اولویت‌بندی پروژه‌ها اعمال می‌شود تا پروژه‌های عام‌المنفعه و خانواده‌محور با مشارکت خیریه‌ها ضریب شتاب بالاتری دریافت کنند.`;
    }
    if (t.includes('تراز') || t.includes('بودجه') || t.includes('وضعیت') || t.includes('status')) {
      const ratio = ((totalExpenses / totalBalance) * 100).toFixed(0);
      return `با استناد به داده‌های خزانه متمرکز ملی، مجموع کل تخصیص‌های پرداخت‌شده تا این لحظه برابر با **${totalExpenses.toLocaleString()} میلیون دلار** است که معادل تقریباً **${ratio}٪** از کل ظرفیت فعال و نقدینگی مصوب خزانه کل کشور (${totalBalance.toLocaleString()} میلیون دلار) می‌باشد. تراز بودجه ملی به لطف مدیریت انضباط مالی در وضعیت پایدار سبز قرار دارد. پیشنهاد ارشد: هدایت ۱۰٪ از منابع مازاد پاییز به سرفصل «زیرساخت‌های عمرانی» جهت تسریع در اتمام پروژه‌های ناتمام راهسازی.`;
    }
    if (t.includes('نیروگاه') || t.includes('خورشیدی') || t.includes('اصفهان') || t.includes('energy')) {
      return `کلان‌پروژه «احداث ابرنیروگاه خورشیدی ۵۰۰ مگاواتی اصفهان» دارای برآورد سرمایه‌گذاری نهایی **۱,۰۰۰ میلیون دلار** است که تاکنون **۳۴۰ میلیون دلار** (معادل ۳۴٪ پیشرفت فیزیکی) آن از ردیف بودجه ساتبا جذب و فونداسیون فاز اول تکمیل شده است. با روند شتاب عمرانی کنونی، اتمام کامل پروژه حدود **۲۴ ماه** زمان خواهد برد. پیشنهاد شبیه‌ساز هوشمند آرا: با تخصیص فوق‌العاده ۱۲۰ میلیون دلار جهت تامین پنل‌های فتوولتائیک نسل جدید، می‌توان مدت زمان راه‌اندازی فاز دوم را به ۱۶ ماه کاهش داد و ناترازی شبکه مرکزی در ساعات پیک تابستان آتی را برطرف نمود.`;
    }
    if (t.includes('فیبر') || t.includes('دیجیتال') || t.includes('شبکه') || t.includes('digital')) {
      return `پروژه ملی «توسعه فاز دوم شبکه ملی فیبر نوری پایدار» یکی از نقاط عطف سند راهبردی ۱۴۰۵ می‌باشد. این پروژه با کل بودجه مورد نیاز **۱,۲۰۰ میلیون دلار** تاکنون موفق به جذب قطعی **۸۵۰ میلیون دلار** (معادل ۷۰٪ پیشرفت فیزیکی) شده است. بر اساس پایش داده‌ای، پوشش خانوارها در کلان‌شهرها به ۸۲٪ رسیده و پیشنهاد حاکمیتی می‌شود با تامین باقیمانده بودجه به مبلغ ۳۵۰ میلیون دلار، بستر اجرای اینترنت پایدار روستایی را در نیمه اول سال مالی آتی هموار سازید.`;
    }
    if (t.includes('سناریو') || t.includes('ناترازی') || t.includes('برق') || t.includes('انرژی') || t.includes('scenario')) {
      return `سناریوی سه مرحله‌ای شبیه‌سازی شده برای مدیریت ناترازی موقت شبکه توزیع انرژی کشور بدین شرح است:
      
۱. **مدیریت تقاضای صنایع (جابجایی بار):** انتقال زمان فعالیت صنایع پرمصرف فولاد و سیمان به ساعات کم‌باری شب همراه با بسته‌های تشویقی کاهش تعرفه.
۲. **تزریق نقدینگی به واحدهای تجدیدپذیر:** تسریع در راه‌اندازی پروژه ۵۰۰ مگاواتی اصفهان با استفاده از تخصیص حواله‌های فوری فوق‌العاده.
۳. **تسهیل تبادل هوشمند فرامرزی:** افزایش ۵٪ واردات موقت الکترونیکی از شبکه‌های همسایه شمالی در ساعات اوج بار میانی روز.`;
    }
    return `سند یا درخواست شما در سیستم پایش حاکمیتی آرا دریافت گردید. من به عنوان «حکیم»، مغز متفکر دوقلوی دیجیتال کشور، آماده‌ام تا داده‌های آمایش منطقه را تحلیل کنم. مایلید در مورد پایش سلول‌های مکعبی نی‌ریز یا مدل سرمایه معنوی با هم تبادل نظر کنیم؟`;
  };

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isThinking) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      sender: 'user',
      text,
      timestamp: new Date()
    };

    const history = [...messages, userMsg];
    setMessages(history);
    setInput('');
    setIsThinking(true);

    let replyText: string;
    let note = '';

    try {
      const grounding = await getHakimGrounding();
      replyText = await chatWithAI(
        history.map((m) => ({ role: m.sender, content: m.text })),
        { system: buildSystemPrompt(totalBalance, totalExpenses, grounding), maxTokens: 2048 }
      );
    } catch (err) {
      note = `⚠️ سرویس برخط در دسترس نبود (${err instanceof Error ? err.message : 'خطای نامشخص'}). پاسخ زیر از دانش محلی آرا است:\n\n`;
      replyText = buildMockReply(text);
    }

    const botMsg: ChatMessage = {
      id: `bot-${Date.now()}`,
      sender: 'assistant',
      text: note + replyText,
      timestamp: new Date()
    };
    setMessages((prev) => {
      const next = [...prev, botMsg];
      // ذخیرهٔ جلسه در خزانهٔ دادهٔ آرا (بازیابی در باز شدن بعدی)
      void getArchive().then((a) =>
        a.put('chats', { id: 'default', at: Date.now(), messages: next, updatedAt: Date.now() }),
      );
      return next;
    });
    setIsThinking(false);
    void recordEvent('chat', 'گفتگو با حکیم', text.trim().slice(0, 70));
  };

  // بازیابی جلسهٔ آخر از خزانهٔ دادهٔ آرا هنگام باز شدن
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    void getArchive()
      .then((a) => a.get<{ id: string; messages?: unknown[] }>('chats', 'default'))
      .then((rec) => {
        if (cancelled || !rec || !Array.isArray(rec.messages) || rec.messages.length === 0) return;
        const saved = rec.messages as Array<{ id?: string; sender?: string; text?: string; timestamp?: unknown }>;
        const restored: ChatMessage[] = saved
          .filter((m) => m && (m.sender === 'user' || m.sender === 'assistant') && typeof m.text === 'string')
          .map((m) => ({
            id: m.id ?? `m-${Math.random().toString(36).slice(2, 8)}`,
            sender: m.sender === 'user' ? 'user' : 'assistant',
            text: m.text as string,
            timestamp: m.timestamp instanceof Date ? m.timestamp : new Date(typeof m.timestamp === 'string' || typeof m.timestamp === 'number' ? m.timestamp : Date.now()),
          }));
        if (restored.length > 0) setMessages(restored);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isThinking]);

  if (!isOpen) return null;

  return (
    <div id="ai-chat-overlay" className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex justify-end transition-all">
      <div 
        id="ai-chat-panel" 
        className="w-full max-w-md bg-surface h-full shadow-2xl flex flex-col animate-slide-in relative text-right"
        style={{ animation: 'slideInRight 0.3s ease-out' }}
      >
        {/* Header */}
        <div id="ai-chat-header" className="bg-brand-800 text-brand-100 p-5 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-signal-400/20 flex items-center justify-center border border-signal-400">
              <Sparkles size={20} className="text-signal-400 animate-pulse" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm">دستیار هوشمند حکمرانی و سیاست‌گذاری (حکیم)</span>
              <span className="text-[10px] text-signal-400">متصل به خزانهٔ دانش حکیم</span>
            </div>
          </div>
          <button 
            id="btn-close-chat" 
            onClick={onClose} 
            className="p-1 hover:bg-surface/10 rounded-lg transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        </div>

        {/* Messages Screen */}
        <div id="ai-chat-body" className="flex-grow p-4 overflow-y-auto bg-surface flex flex-col gap-4">
          {messages.map((msg) => (
            <div 
              key={msg.id}
              className={`flex gap-3 max-w-[85%] ${
                msg.sender === 'user' ? 'self-end flex-row-reverse' : 'self-start'
              }`}
            >
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${
                msg.sender === 'user' 
                  ? 'bg-brand-800 text-white' 
                  : 'bg-signal-400 text-brand-800'
              }`}>
                {msg.sender === 'user' ? <User size={14} /> : <Bot size={14} />}
              </div>

              <div className={`p-3.5 rounded-2xl text-xs leading-relaxed shadow-sm ${
                msg.sender === 'user'
                  ? 'bg-brand-800 text-white rounded-tr-none'
                  : 'bg-surface border border-line text-ink-800 rounded-tl-none'
              }`}>
                {msg.text.split('\n').map((line, idx) => (
                  <p key={idx} className={idx > 0 ? 'mt-1.5' : ''}>
                    {line}
                  </p>
                ))}
              </div>
            </div>
          ))}

          {isThinking && (
            <div className="flex gap-3 self-start max-w-[85%]">
              <div className="w-8 h-8 rounded-full bg-signal-400 text-brand-800 flex items-center justify-center text-xs flex-shrink-0">
                <Bot size={14} />
              </div>
              <div className="p-3.5 rounded-2xl text-xs bg-surface border border-line text-ink-500 rounded-tl-none flex items-center gap-2">
                <span className="animate-pulse">در حال تحلیل حکیم…</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Suggested Questions */}
        <div id="ai-chat-suggestions" className="p-3 border-t border-line bg-surface flex flex-col gap-2">
          <span className="text-[10px] text-ink-500 font-semibold flex items-center gap-1">
            <HelpCircle size={12} /> پرسش‌های پیشنهادی شبیه‌ساز:
          </span>
          <div className="flex flex-wrap gap-1.5">
            {suggestedQuestions.map((q, idx) => (
              <button
                key={idx}
                onClick={() => handleSendMessage(q.text)}
                disabled={isThinking}
                className="text-[10px] bg-brand-100 text-brand-800 hover:bg-signal-400/30 transition-colors px-2.5 py-1.5 rounded-full font-medium cursor-pointer text-right disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {q.text}
              </button>
            ))}
          </div>
        </div>

        {/* Input Bar */}
        <div id="ai-chat-input-bar" className="p-4 border-t border-line bg-surface flex items-center gap-3">
          <input
            id="chat-input"
            type="text"
            placeholder="پرسش خود را بنویسید (مثلاً: تراز بودجه چطور است؟)..."
            value={inputValue}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSendMessage(inputValue);
            }}
            disabled={isThinking}
            className="flex-grow bg-paper border border-line rounded-xl px-4 py-3 text-xs text-ink-800 focus:outline-none focus:border-brand-800 transition-colors disabled:opacity-50"
          />
          <button
            id="btn-send-message"
            onClick={() => handleSendMessage(inputValue)}
            disabled={isThinking}
            className="w-10 h-10 rounded-xl bg-brand-800 hover:bg-brand-700 text-white flex items-center justify-center transition-colors cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send size={16} className="rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}
