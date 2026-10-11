import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { 
  LayoutGrid, 
  ArrowRightLeft, 
  TrendingUp, 
  Wallet, 
  Users, 
  Settings,
  ShieldCheck,
  ShieldAlert,
  Radio,
  ChevronRight,
  ChevronLeft,
  Menu,
  X,
  Map,
  SlidersHorizontal,
  Briefcase,
  Cpu,
  Zap,
  Layers,
  Boxes,
  Search,
  CornerDownLeft,
  Brain,
  Bot
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  isPremium: boolean;
  setIsPremium: (isPremium: boolean) => void;
}

// Navigation categories structured logically into 3 sections (static, module-level)
const menuCategories = [
  {
    title: 'داشبورد ملی',
    items: [
      { id: 'dashboard', label: 'اتاق وضعیت ملی', icon: LayoutGrid },
      { id: 'scenario-builder', label: 'سناریوساز', icon: Cpu },
      { id: 'neighborhood-typology', label: 'گونه‌شناسی محلات', icon: Layers },
      { id: 'decision-support', label: 'تصمیم‌یار جامع محله', icon: Brain },
      { id: 'agentic-framework', label: 'فریمورک ایجنتیک (عامل‌ها)', icon: Bot },
      { id: 'kernel-core', label: 'هستهٔ محاسبات (kernel)', icon: Boxes },
      { id: 'ppe-engine', label: 'موتور اولویت‌بندی پروژه‌ها', icon: Zap },
      { id: 'portfolio', label: 'سبد سیاست و پروژه', icon: Briefcase },
      { id: 'regional-planning', label: 'برنامه‌ریزی منطقه‌ای', icon: SlidersHorizontal },
      { id: 'territorial-gis', label: 'نقشه سرزمینی', icon: Map },
      { id: 'analytics', label: 'آمار و شبیه‌سازی کلان', icon: TrendingUp },
    ]
  },
  {
    title: 'مدیریت مالی',
    items: [
      { id: 'transactions', label: 'سندهای تخصیص بودجه', icon: ArrowRightLeft },
      { id: 'wallet', label: 'خزانه متمرکز سرزمینی', icon: Wallet },
    ]
  },
  {
    title: 'پشتیبانی و تنظیمات',
    items: [
      { id: 'users', label: 'کارگزاران و ناظران کل', icon: Users },
      { id: 'settings', label: 'تنظیمات امنیت سیستم', icon: Settings },
    ]
  }
];

export default function Sidebar({ currentTab, setCurrentTab, isPremium, setIsPremium }: SidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  // موقعیت شناور راهنمای شناور (tooltip) در حالت جمع‌شده — با position:fixed خارج از اسکرولر
  const [tooltip, setTooltip] = useState<{ label: string; x: number; y: number } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // میان‌برهای صفحه‌کلید: Ctrl/Cmd+B برای جمع‌کردن منو، / برای جستجو، Escape برای بستن
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleCollapsed();
      } else if (e.key === '/' && !isCollapsed && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName || '')) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape') {
        setSearchQuery('');
        setIsMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isCollapsed]);

  // جمع/بازکردن منو با پاک‌سازی جستجو و راهنمای شناور
  const toggleCollapsed = () => {
    setSearchQuery('');
    setTooltip(null);
    setIsCollapsed((prev) => !prev);
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  // فیلتر زندهٔ آیتم‌های منو بر اساس جستجو (بخش‌های بدون نتیجه حذف می‌شوند)
  const visibleCategories = useMemo(() => {
    if (!normalizedQuery) return menuCategories;
    return menuCategories
      .map((cat) => ({
        ...cat,
        items: cat.items.filter((it) => it.label.toLowerCase().includes(normalizedQuery)),
      }))
      .filter((cat) => cat.items.length > 0);
  }, [normalizedQuery, menuCategories]);

  const totalMatches = visibleCategories.reduce((sum, cat) => sum + cat.items.length, 0);

  const showTooltip = (e: ReactMouseEvent<HTMLButtonElement>, label: string) => {
    if (!isCollapsed) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setTooltip({ label, x: rect.left - 10, y: rect.top + rect.height / 2 });
  };

  return (
    <>
      {/* Mobile Toggle Trigger Button (visible on small screens) */}
      <button
        onClick={() => setIsMobileOpen(!isMobileOpen)}
        className="lg:hidden fixed bottom-5 right-5 z-50 p-3 bg-brand-800 text-signal-400 rounded-2xl shadow-[var(--shadow-pop)] border border-signal-400/30 flex items-center justify-center transition-transform hover:scale-110 active:scale-95 cursor-pointer"
        aria-label="باز و بستن منو"
      >
        {isMobileOpen ? <X size={22} /> : <Menu size={22} />}
      </button>

      {/* Mobile Overlay Backdrop */}
      {isMobileOpen && (
        <div 
          onClick={() => setIsMobileOpen(false)}
          className="lg:hidden fixed inset-0 bg-ink-900/50 backdrop-blur-sm z-40 animate-fade-in"
        />
      )}

      {/* Main Sidebar Container */}
      <div 
        id="sidebar" 
        onScroll={() => setTooltip(null)}
        className={`bg-gradient-to-b from-white via-brand-50/50 to-brand-100/40 dark:from-wall-900 dark:via-wall-900 dark:to-wall-950 text-ink-800 dark:text-slate-200 border-l border-line dark:border-wall-700 flex flex-col items-stretch p-3.5 h-screen sticky top-0 overflow-y-auto select-none shrink-0 shadow-[var(--shadow-pop)] transition-all duration-300 z-40 [scrollbar-width:thin] [scrollbar-color:var(--color-brand-200)_transparent] [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-brand-200 [&::-webkit-scrollbar-track]:bg-transparent dark:[scrollbar-color:var(--color-wall-700)_transparent] ${
          isCollapsed ? 'w-[76px]' : 'w-[264px]'
        } ${
          isMobileOpen 
            ? 'fixed right-0 top-0 w-[264px] translate-x-0' 
            : 'max-lg:fixed max-lg:right-0 max-lg:top-0 max-lg:w-[264px] max-lg:translate-x-full lg:translate-x-0'
        }`}
      >
        
        {/* Brand & National Emblem Header with Desktop Collapse Button */}
        <div 
          id="sidebar-logo" 
          className="flex items-center justify-between px-1 py-2 border-b border-line dark:border-wall-700 pb-3"
        >
          <div 
            className="flex items-center gap-3 cursor-pointer transition-all hover:opacity-90 overflow-hidden" 
            onClick={() => {
              setCurrentTab('dashboard');
              setIsMobileOpen(false);
            }}
            title="سامانه آرا - اتاق وضعیت ملی"
          >
            <div id="logo-icon" className="relative w-9 h-9 flex-shrink-0 flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-700 to-brand-900 text-signal-400 border border-brand-800/20 shadow-[0_4px_14px_rgba(29,89,64,0.35)]">
              <div className="absolute size-2 rounded-full bg-ok top-1 right-1 animate-live-pulse" />
              <div className="absolute size-1.5 rounded-full bg-signal-400 bottom-1 left-1" />
              <Radio size={16} />
            </div>
            
            {!isCollapsed && (
              <div id="logo-text" className="flex flex-col text-right whitespace-nowrap animate-fade-in">
                <span className="font-sans font-black text-base tracking-tight text-ink-900 dark:text-white flex items-center gap-2">
                  آرا
                  <span className="flex items-center gap-1 text-[8px] font-black text-ok-700 dark:text-ok bg-ok-soft dark:bg-wall-800 border border-ok/40 dark:border-wall-600 px-1.5 py-0.5 rounded-full">
                    <span className="size-1 rounded-full bg-ok animate-live-pulse" />
                    برخط
                  </span>
                </span>
                <span className="text-[9px] text-ink-500 dark:text-slate-400 -mt-0.5 font-bold">حکمرانی هوشمند ایران</span>
              </div>
            )}
          </div>

          {/* Desktop Collapse / Expand Toggle Button */}
          <button
            onClick={toggleCollapsed}
            className="hidden lg:flex p-1.5 rounded-xl bg-brand-50 hover:bg-brand-100 text-brand-700 dark:bg-wall-800 dark:text-signal-400 dark:hover:bg-wall-700 border border-line dark:border-wall-700 transition-all cursor-pointer shrink-0 hover:shadow-sm"
            title={isCollapsed ? "بزرگ‌نمایی منوی کناری (Ctrl+B)" : "جمع‌کردن منوی کناری (Ctrl+B)"}
          >
            {isCollapsed ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        </div>

        {/* Quick Search Filter (expanded mode only) */}
        {!isCollapsed && (
          <div className="relative mt-3 animate-fade-in">
            <Search size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 dark:text-slate-500 pointer-events-none" />
            <input
              ref={searchRef}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="جستجوی سریع منو..."
              className="w-full bg-surface/80 dark:bg-wall-800 border border-line dark:border-wall-700 rounded-xl pr-8 pl-8 py-2 text-[11px] font-semibold text-ink-800 dark:text-slate-200 placeholder:text-ink-400 dark:placeholder:text-slate-500 focus:outline-none focus:border-brand-400 focus:ring-2 focus:ring-brand-800/10 dark:focus:ring-signal-400/20 transition-all"
            />
            {searchQuery ? (
              <button
                onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}
                className="absolute left-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-ink-400 hover:text-danger hover:bg-danger-soft transition-colors cursor-pointer"
                title="پاک کردن جستجو"
              >
                <X size={12} />
              </button>
            ) : (
              <span className="absolute left-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1 text-[8.5px] font-black text-ink-300 dark:text-slate-600 pointer-events-none">
                <CornerDownLeft size={10} />
              </span>
            )}
          </div>
        )}

        {/* Navigation Groups with 3 Categorized Sections */}
        <div className="flex flex-col gap-4 flex-grow my-3">
          {normalizedQuery && visibleCategories.length === 0 ? (
            /* Empty search state */
            <div className="flex flex-col items-center justify-center gap-2.5 py-10 text-center animate-fade-in">
              <div className="size-10 rounded-xl bg-brand-50 dark:bg-wall-800 border border-line dark:border-wall-700 flex items-center justify-center">
                <Search size={16} className="text-ink-300 dark:text-slate-600" />
              </div>
              <div className="flex flex-col gap-0.5">
                <p className="text-[11px] font-black text-ink-800 dark:text-slate-200">موردی یافت نشد</p>
                <p className="text-[9px] text-ink-500 dark:text-slate-400">عبارت دیگری را امتحان کنید</p>
              </div>
              <button
                onClick={() => { setSearchQuery(''); searchRef.current?.focus(); }}
                className="text-[10px] font-black text-brand-700 dark:text-signal-400 hover:underline transition-colors cursor-pointer"
              >
                پاک کردن جستجو
              </button>
            </div>
          ) : (
            visibleCategories.map((category, catIndex) => (
              <div key={catIndex} className={`flex flex-col gap-1.5 ${catIndex === 2 ? 'border-t border-line dark:border-wall-700 pt-3' : ''}`}>
                
                {/* Category Header (Hidden if collapsed) */}
                {!isCollapsed ? (
                  <div className="flex items-center justify-between px-2 mb-0.5 animate-fade-in">
                    <h3 className="text-[10px] uppercase font-black text-brand-700/70 dark:text-signal-400/70 tracking-wider">
                      {category.title}
                    </h3>
                    <span className="w-8 h-[1px] bg-gradient-to-l from-brand-800/30 to-transparent dark:from-signal-400/30"></span>
                  </div>
                ) : (
                  <div className="h-[1px] bg-line dark:bg-wall-700 my-1" />
                )}
                
                <nav className="flex flex-col gap-1">
                  {category.items.map((item) => {
                    const Icon = item.icon;
                    const isActive = currentTab === item.id;
                    return (
                      <button
                        key={item.id}
                        id={`nav-item-${item.id}`}
                        onClick={() => {
                          setCurrentTab(item.id);
                          setIsMobileOpen(false);
                        }}
                        onMouseEnter={(e) => showTooltip(e, item.label)}
                        onMouseLeave={() => setTooltip(null)}
                        className={`relative flex items-center w-full rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer group overflow-visible ${
                          isCollapsed ? 'justify-center p-2' : 'justify-between px-2.5 py-2'
                        } ${
                          isActive
                            ? 'bg-gradient-to-l from-brand-800/10 via-brand-800/5 to-transparent text-brand-800 dark:from-wall-700/60 dark:via-wall-700/30 dark:to-transparent dark:text-signal-400 ring-1 ring-brand-800/10 dark:ring-wall-700 shadow-sm'
                            : 'text-ink-500 hover:bg-brand-50 dark:text-slate-400 dark:hover:bg-wall-800 dark:hover:text-signal-400 hover:text-brand-800'
                        }`}
                      >
                        {/* Active Accent Indicator (right edge in RTL) */}
                        {isActive && (
                          <span className="absolute right-0 top-1.5 bottom-1.5 w-[3px] rounded-l-full bg-gradient-to-b from-brand-500 to-brand-800 dark:from-signal-400 dark:to-brand-500 shadow-[0_0_10px_rgba(60,156,106,0.55)]" />
                        )}

                        <div className={`flex items-center gap-2.5 min-w-0 ${isCollapsed ? '' : 'pr-1'}`}>
                          {/* Icon Tile */}
                          <span className={`flex items-center justify-center size-8 rounded-lg border shrink-0 transition-all duration-200 ${
                            isActive
                              ? 'bg-brand-800 text-signal-400 border-brand-800 shadow-[0_3px_12px_rgba(29,89,64,0.35)] scale-105'
                              : 'bg-white/80 text-brand-700 border-line group-hover:bg-brand-100 group-hover:border-brand-200 group-hover:scale-105 dark:bg-wall-800 dark:text-signal-400 dark:border-wall-700 dark:group-hover:bg-wall-700'
                          }`}>
                            <Icon size={15} strokeWidth={2.2} />
                          </span>
                          {!isCollapsed && (
                            <span className="truncate whitespace-nowrap text-right font-bold animate-fade-in">{item.label}</span>
                          )}
                        </div>

                        {!isCollapsed && isActive && (
                          <span className="flex items-center gap-1.5 shrink-0">
                            {item.id === 'dashboard' && (
                              <span className="flex items-center gap-1 text-[8px] font-black text-ok-700 dark:text-ok bg-ok-soft dark:bg-wall-800 border border-ok/40 dark:border-wall-600 rounded-full px-1.5 py-0.5">
                                <span className="size-1 rounded-full bg-ok animate-live-pulse" /> برخط
                              </span>
                            )}
                            <ChevronLeft size={13} className="text-brand-700 dark:text-signal-400" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>
            ))
          )}
        </div>

        {/* Search Result Counter */}
        {!isCollapsed && normalizedQuery && visibleCategories.length > 0 && (
          <div className="px-2 pb-1 -mt-2 text-[9px] font-bold text-ink-400 dark:text-slate-500 animate-fade-in">
            {totalMatches} مورد یافت شد
          </div>
        )}

        {/* Security Clearance Control Center */}
        <div className="border-t border-line dark:border-wall-700 pt-3 flex flex-col gap-2.5">
          {!isCollapsed ? (
            !isPremium ? (
              <div id="premium-banner" className="bg-gradient-to-br from-danger-soft/70 via-surface to-white dark:from-wall-800 dark:via-wall-850 dark:to-wall-900 text-brand-100 rounded-2xl p-3 relative overflow-hidden flex flex-col gap-2 border border-danger/20 dark:border-wall-700 shadow-inner animate-fade-in">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-danger/15 text-danger-700 dark:text-danger flex items-center justify-center shrink-0 border border-danger/40">
                    <ShieldAlert size={14} className="animate-pulse" />
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10.5px] font-black text-danger-700 dark:text-danger">سطح پایش عادی</span>
                    <span className="text-[8.5px] text-ink-500 dark:text-slate-400 font-bold">دسترسی عمومی</span>
                  </div>
                </div>

                <p id="premium-desc" className="text-[9px] leading-relaxed text-ink-500 dark:text-slate-400">
                  جهت بازگشایی پرونده‌های طبقه‌بندی شده ارتقا دهید.
                </p>

                <button
                  id="btn-upgrade"
                  onClick={() => setIsPremium(true)}
                  className="w-full py-1.5 bg-brand-800 hover:bg-brand-700 active:scale-[0.98] transition-all text-signal-400 rounded-xl text-[10px] font-black shadow-md cursor-pointer"
                >
                  ارتقای مجوز
                </button>
              </div>
            ) : (
              <div id="premium-success-banner" className="bg-gradient-to-br from-brand-50 via-surface to-white dark:from-wall-800 dark:via-wall-850 dark:to-wall-900 border border-brand-800/20 dark:border-wall-700 text-white rounded-2xl p-3 relative overflow-hidden flex flex-col gap-1.5 shadow-sm animate-fade-in">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-brand-800 text-signal-400 flex items-center justify-center shrink-0 font-bold shadow-[0_3px_10px_rgba(29,89,64,0.35)]">
                    <ShieldCheck size={15} />
                  </div>
                  <div className="flex flex-col text-right">
                    <span className="text-[10.5px] font-black text-brand-800 dark:text-signal-400">پایش ارشد فعال</span>
                    <span className="text-[8.5px] text-ink-500 dark:text-slate-400 font-bold">دسترسی‌های کامل</span>
                  </div>
                </div>
                
                <button
                  onClick={() => setIsPremium(false)}
                  className="w-full py-1 bg-brand-50 hover:bg-brand-100 dark:bg-wall-700 dark:hover:bg-wall-600 border border-line dark:border-wall-600 text-ink-700 dark:text-slate-300 transition-all rounded-lg text-[9px] font-bold cursor-pointer"
                >
                  تقلیل سطح دسترسی
                </button>
              </div>
            )
          ) : (
            <div className="flex justify-center" title={isPremium ? "سطح پایش ارشد فعال" : "سطح پایش عادی"}>
              <button 
                onClick={() => setIsPremium(!isPremium)}
                className={`p-2 rounded-xl border transition-all cursor-pointer ${
                  isPremium 
                    ? 'bg-brand-800 text-signal-400 border-brand-800 shadow-[0_3px_12px_rgba(29,89,64,0.35)]' 
                    : 'bg-danger/10 text-danger-700 dark:text-danger border-danger/30'
                }`}
              >
                {isPremium ? <ShieldCheck size={18} /> : <ShieldAlert size={18} />}
              </button>
            </div>
          )}
        </div>

        {/* Logged-in Executive User profile */}
        <div className="border-t border-line dark:border-wall-700 pt-3 mt-2.5 flex items-center gap-2.5">
          <div className="relative shrink-0 mx-auto">
            <img 
              src="/avatar.svg" 
              alt="دکتر امین کلانتری"
              className="w-9 h-9 rounded-xl object-cover border border-brand-800/20 dark:border-wall-600 shadow-sm"
            />
            <div className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-ok border-2 border-surface dark:border-wall-900" />
          </div>
          {!isCollapsed && (
            <div className="flex flex-col text-right min-w-0 animate-fade-in">
              <span className="text-[11px] font-black text-ink-900 dark:text-white truncate">دکتر امین کلانتری</span>
              <span className="text-[8.5px] text-ink-500 dark:text-slate-400 font-bold truncate">وزیر امور اقتصادی و دارایی</span>
            </div>
          )}
        </div>

        {/* Version Footer */}
        {!isCollapsed && (
          <div className="pt-2.5 mt-1 flex items-center justify-center gap-1.5 text-[8.5px] font-bold text-ink-400 dark:text-slate-500 animate-fade-in">
            <span>نسخه ۴.۲.۰</span>
            <span className="size-0.5 rounded-full bg-line-strong dark:bg-wall-700" />
            <span>سامانه آرا</span>
          </div>
        )}
      </div>

      {/* Floating Tooltip for Collapsed Mode (position:fixed, rendered outside the scroll container) */}
      {tooltip && isCollapsed && (
        <div 
          className="fixed z-[70] pointer-events-none"
          style={{ left: tooltip.x, top: tooltip.y, transform: 'translate(-100%, -50%)' }}
        >
          <div className="relative flex items-center gap-1.5 rounded-lg bg-ink-900 text-white text-[10px] font-black px-2.5 py-1.5 shadow-xl whitespace-nowrap animate-fade-in">
            {tooltip.label}
            <span className="absolute -right-[5px] top-1/2 -translate-y-1/2 size-0 border-y-[5px] border-y-transparent border-l-[5px] border-l-ink-900" />
          </div>
        </div>
      )}
    </>
  );
}
