import { useState, useEffect, lazy, Suspense } from 'react';
import { 
  initialBudgetTransactions, 
  initialNationalProjects, 
  initialGovernanceLogs 
} from './data';
import { BudgetTransaction, NationalProject, GovernanceLog } from './types';

// Component Imports
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import WalletCard from './components/WalletCard';
import Statistics from './components/Statistics';
import CashFlowChart from './components/CashFlowChart';
import RecentTransactions from './components/RecentTransactions';
import SavingPlans from './components/SavingPlans';
import CategoryDonut from './components/CategoryDonut';
import ActivityLogs from './components/ActivityLogs';
import AIChatModal from './components/AIChatModal';

// صفحات سنگین (نقشه/نمودار) به‌صورت تنبل بارگذاری می‌شوند تا باندل اصلی سبک بماند
const SciPopulationPanel = lazy(() => import('./components/SciPopulationPanel'));
const NationalSituationRoom = lazy(() => import('./components/NationalSituationRoom'));
const TerritorialWebGISPage = lazy(() => import('./components/TerritorialWebGISPage'));
const RegionalPlanningPage = lazy(() => import('./components/RegionalPlanningPage'));
const PortfolioPage = lazy(() => import('./components/PortfolioPage'));
const ScenarioBuilderPage = lazy(() => import('./components/ScenarioBuilderPage'));
const ProjectPrioritizationEnginePage = lazy(() => import('./components/ProjectPrioritizationEnginePage'));
const NeighborhoodTypologyPage = lazy(() => import('./components/NeighborhoodTypologyPage'));
const DecisionSupportPage = lazy(() => import('./components/DecisionSupportPage'));
const KernelCorePage = lazy(() => import('./components/KernelCorePage'));
const AgenticFrameworkPage = lazy(() => import('./components/AgenticFrameworkPage'));

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center" role="status" aria-busy="true">
      <div className="flex items-center gap-3 text-xs font-bold text-ink-500">
        <span className="size-4 animate-spin rounded-full border-2 border-brand-300 border-t-brand-800" />
        در حال بارگذاری ماژول تحلیلی…
      </div>
    </div>
  );
}

type FontVariant = 'standard' | 'round-dots';

// Social Logos & Icons Fallback
import { 
  Facebook, 
  Twitter, 
  Instagram, 
  Youtube, 
  Linkedin,
  MapPin,
  TrendingUp
} from 'lucide-react';

export default function App() {
  // App States
  const [currentTab, setCurrentTab] = useState<string>('dashboard');
  const [isPremium, setIsPremium] = useState<boolean>(true); // Default to premium for governance admin
  const [isAIChatOpen, setIsAIChatOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  // استانی که از داشبورد درخواست شده تا در ژئوپرتال متمرکز شود (کد استان مثل TEH)
  const [gisFocusProvince, setGisFocusProvince] = useState<string | null>(null);
  // بازکردن ژئوپرتال متمرکز روی یک استان مشخص
  const handleOpenGeoportal = (provinceId: string) => {
    setGisFocusProvince(provinceId);
    setCurrentTab('territorial-gis');
  };

  // Governance lists
  const [transactions, setTransactions] = useState<BudgetTransaction[]>(initialBudgetTransactions);
  const [savingPlans, setSavingPlans] = useState<NationalProject[]>(initialNationalProjects);
  const [activityLogs, setActivityLogs] = useState<GovernanceLog[]>(initialGovernanceLogs);
  
  // Treasury Balances (in Million Dollars)
  const [totalBalance, setTotalBalance] = useState<number>(14200);
  const [totalIncoming, setTotalIncoming] = useState<number>(5500); 
  const [totalExpenses, setTotalExpenses] = useState<number>(3120); 

  // Re-calculate statistics dynamically whenever transactions or plans update
  useEffect(() => {
    const computedInflows = transactions
      .filter(t => t.type === 'allocation' && t.status === 'approved')
      .reduce((sum, t) => sum + t.amount, 0);
    
    const computedOutflows = transactions
      .filter(t => t.type === 'withdrawal' && t.status === 'approved')
      .reduce((sum, t) => sum + t.amount, 0);

    setTotalIncoming(computedInflows + 10000); // Baseline 10k million
    setTotalExpenses(computedOutflows + 2000);   // Baseline 2k million
  }, [transactions]);

  // Business Action: Inject Capital to Treasury (تزریق منابع ارزی به خزانه ملی)
  const handleDeposit = (amount: number) => {
    setTotalBalance((prev) => prev + amount);
    
    const newTx: BudgetTransaction = {
      id: `tx-${Date.now()}`,
      name: 'تزریق مستقیم منابع مالی حاکمیتی',
      category: 'درآمدهای عمومی دولت',
      recipient: 'خزانه متمرکز ملی',
      amount,
      date: getPersianDate(),
      type: 'allocation',
      status: 'approved'
    };

    const newLog: GovernanceLog = {
      id: `log-${Date.now()}`,
      userId: 'admin-1',
      userName: 'دکتر امین کلانتری',
      userAvatar: '/avatar.svg',
      role: 'وزیر امور اقتصادی و دارایی',
      description: `تزریق اضطراری منابع مالی به میزان ${amount.toLocaleString()} میلیون دلار به خزانه متمرکز ملی را ابلاغ کرد.`,
      time: 'هم‌اکنون',
      statusColor: '#10B981'
    };

    setTransactions((prev) => [newTx, ...prev]);
    setActivityLogs((prev) => [newLog, ...prev]);
  };

  // Business Action: Direct Budget Wire (صدور سند تخصیص بودجه ملی)
  const handleTransfer = (amount: number, recipient: string, name: string) => {
    if (amount > totalBalance) {
      alert('موجودی نقدی خزانه کل برای تخصیص این رقم کافی نیست.');
      return;
    }

    setTotalBalance((prev) => prev - amount);

    const newTx: BudgetTransaction = {
      id: `tx-${Date.now()}`,
      name,
      category: 'سند ابلاغی بودجه',
      recipient,
      amount,
      date: getPersianDate(),
      type: 'withdrawal',
      status: 'approved'
    };

    const newLog: GovernanceLog = {
      id: `log-${Date.now()}`,
      userId: 'admin-1',
      userName: 'دکتر امین کلانتری',
      userAvatar: '/avatar.svg',
      role: 'وزیر امور اقتصادی و دارایی',
      description: `سند تخصیص بودجه به مبلغ ${amount.toLocaleString()} میلیون دلار برای نهاد «${recipient}» را صادر نمود.`,
      time: 'هم‌اکنون',
      statusColor: '#EF4444'
    };

    setTransactions((prev) => [newTx, ...prev]);
    setActivityLogs((prev) => [newLog, ...prev]);
  };

  // Business Action: Add Transaction Record (ثبت سند تخصیص بودجه دستی)
  const handleAddTransaction = (
    name: string,
    category: string,
    recipient: string,
    amount: number,
    type: 'allocation' | 'withdrawal',
    status: 'approved' | 'rejected' | 'review'
  ) => {
    if (type === 'withdrawal' && status === 'approved' && amount > totalBalance) {
      alert('موجودی نقدینه خزانه جهت تأیید آنی این سند کافی نیست. سند در وضعیت «تحت بررسی دیوان محاسبات» ثبت گردید.');
      status = 'review';
    }

    const newTx: BudgetTransaction = {
      id: `tx-${Date.now()}`,
      name,
      category,
      recipient,
      amount,
      date: getPersianDate(),
      type,
      status
    };

    if (status === 'approved') {
      setTotalBalance((prev) => (type === 'allocation' ? prev + amount : prev - amount));
    }

    const newLog: GovernanceLog = {
      id: `log-${Date.now()}`,
      userId: 'admin-1',
      userName: 'دکتر امین کلانتری',
      userAvatar: '/avatar.svg',
      role: 'وزیر امور اقتصادی و دارایی',
      description: `سند مالی جدیدی بابت «${name}» با وضعیت ${
        status === 'approved' ? 'تأیید قطعی' : status === 'rejected' ? 'مردود دیوان' : 'در حال بررسی'
      } ثبت کرد.`,
      time: 'هم‌اکنون',
      statusColor: status === 'approved' ? '#10B981' : status === 'rejected' ? '#EF4444' : '#F59E0B'
    };

    setTransactions((prev) => [newTx, ...prev]);
    setActivityLogs((prev) => [newLog, ...prev]);
  };

  // Business Action: Delete single transaction (ابطال سند تخصیص بودجه)
  const handleDeleteTransaction = (id: string) => {
    const tx = transactions.find((t) => t.id === id);
    if (!tx) return;

    if (tx.status === 'approved') {
      setTotalBalance((prev) => (tx.type === 'allocation' ? prev - tx.amount : prev + tx.amount));
    }

    setTransactions((prev) => prev.filter((t) => t.id !== id));

    const newLog: GovernanceLog = {
      id: `log-${Date.now()}`,
      userId: 'admin-1',
      userName: 'دکتر امین کلانتری',
      userAvatar: '/avatar.svg',
      role: 'وزیر امور اقتصادی و دارایی',
      description: `سند تخصیص بودجه شماره ${id.substring(0, 6)} را رسماً ابطال و از سیستم محاسبات مالی خارج کرد.`,
      time: 'هم‌اکنون',
      statusColor: '#6B7271'
    };

    setActivityLogs((prev) => [newLog, ...prev]);
  };

  // Business Action: Create savings target (تعریف کلان‌پروژه جدید ملی)
  const handleAddPlan = (
    title: string,
    target: number,
    category: 'energy' | 'digital' | 'infrastructure' | 'welfare' | 'cultural' | 'mining' | 'social'
  ) => {
    const newPlan: NationalProject = {
      id: `plan-${Date.now()}`,
      title,
      category,
      savedAmount: 0,
      targetAmount: target,
      percentage: 0
    };

    const newLog: GovernanceLog = {
      id: `log-${Date.now()}`,
      userId: 'admin-1',
      userName: 'دکتر امین کلانتری',
      userAvatar: '/avatar.svg',
      role: 'وزیر امور اقتصادی و دارایی',
      description: `کلان‌پروژه ملی «${title}» را در فهرست مصوب پروژه‌های راهبردی کشور به ثبت رساند.`,
      time: 'هم‌اکنون',
      statusColor: '#1E4841'
    };

    setSavingPlans((prev) => [...prev, newPlan]);
    setActivityLogs((prev) => [newLog, ...prev]);
  };

  // Business Action: Contribute funds to saving targets (تخصیص نقدینگی مستقیم به پروژه ملی)
  const handleContribute = (planId: string, amount: number) => {
    setSavingPlans((prev) => 
      prev.map((plan) => {
        if (plan.id === planId) {
          const newSaved = plan.savedAmount + amount;
          const newPercentage = Math.min(Math.round((newSaved / plan.targetAmount) * 100), 100);
          return {
            ...plan,
            savedAmount: newSaved,
            percentage: newPercentage
          };
        }
        return plan;
      })
    );

    setTotalBalance((prev) => prev - amount);

    const plan = savingPlans.find(p => p.id === planId);
    const newLog: GovernanceLog = {
      id: `log-${Date.now()}`,
      userId: 'admin-1',
      userName: 'دکتر امین کلانتری',
      userAvatar: '/avatar.svg',
      role: 'وزیر امور اقتصادی و دارایی',
      description: `مبلغ ${amount.toLocaleString()} میلیون دلار نقدینگی عمرانی از خزانه کل به پروژه «${plan?.title || 'کلان‌پروژه ملی'}» تخصیص داد.`,
      time: 'هم‌اکنون',
      statusColor: '#10B981'
    };

    setActivityLogs((prev) => [newLog, ...prev]);
  };

  // Clear timeline logs
  const handleClearLogs = () => {
    setActivityLogs([]);
  };

  // Helper date maker in Persian
  const getPersianDate = (): string => {
    const today = new Date();
    const d = today.getDate().toString().padStart(2, '0');
    return `۱۴۰۵/۰۵/${d}`;
  };

  const [isWallMode, setIsWallMode] = useState<boolean>(false);

  // گونهٔ قلم وزیرمتن (استاندارد / Round-Dots) — هم‌گام با کلاس روی <html> و localStorage
  const [fontVariant, setFontVariant] = useState<FontVariant>(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem('ara-font-variant') === 'round-dots'
      ? 'round-dots'
      : 'standard')
  );

  useEffect(() => {
    const root = document.documentElement as HTMLElement;
    root.classList.toggle('font-round-dots', fontVariant === 'round-dots');
    try {
      localStorage.setItem('ara-font-variant', fontVariant);
    } catch {
      /* حالت خصوصی مرورگر — ذخیره نمی‌شود، انتخاب فعلی در نشست فعال می‌ماند */
    }
  }, [fontVariant]);

  const applyFontVariant = (variant: FontVariant) => setFontVariant(variant);

  return (
    <div dir="rtl" className={`min-h-screen font-sans flex flex-col antialiased transition-colors duration-500 ${isWallMode ? 'dark bg-wall-950 text-slate-100' : 'bg-paper text-ink-800'}`}>
      {/* Outer App Frame Container */}
      <div id="app-wrapper" className="flex flex-row flex-grow w-full h-full relative">
        
        {/* RIGHT SIDEBAR (RTL aligns on right side) */}
        <Sidebar 
          currentTab={currentTab} 
          setCurrentTab={setCurrentTab} 
          isPremium={isPremium} 
          setIsPremium={setIsPremium} 
        />

        {/* LEFT PRIMARY PANEL (RTL main workspace) */}
        <div id="main-content-panel" className="flex-grow flex flex-col h-screen overflow-y-auto min-w-0">
          
          {/* Header element */}
          <Header 
            onSearchChange={setSearchQuery} 
            onOpenAIChat={() => setIsAIChatOpen(true)} 
            isPremium={isPremium}
            isWallMode={isWallMode}
            onToggleWallMode={() => setIsWallMode(!isWallMode)}
          />

          {/* Tab Route Switching Screen Assemblies */}
          <main id="main-scrollable-body" className={`flex-grow flex flex-col ${currentTab === 'territorial-gis' ? 'p-0 overflow-hidden' : isWallMode ? 'p-6 bg-wall-950 gap-8' : 'p-6 lg:p-8 gap-6'} transition-all duration-300`}>
            {currentTab === 'dashboard' && (
              <div id="tab-dashboard" className="flex flex-col gap-6 animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <NationalSituationRoom 
                    isWallMode={isWallMode} 
                    setIsWallMode={setIsWallMode} 
                    onOpenGeoportal={handleOpenGeoportal}
                  />
                </Suspense>
              </div>
            )}

            {currentTab === 'scenario-builder' && (
              <div id="tab-scenario-builder" className="w-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <ScenarioBuilderPage />
                </Suspense>
              </div>
            )}

            {currentTab === 'neighborhood-typology' && (
              <div id="tab-neighborhood-typology" className="w-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <NeighborhoodTypologyPage onOpenGeoportal={handleOpenGeoportal} />
                </Suspense>
              </div>
            )}

            {currentTab === 'decision-support' && (
              <div id="tab-decision-support" className="w-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <DecisionSupportPage />
                </Suspense>
              </div>
            )}

            {currentTab === 'agentic-framework' && (
              <div id="tab-agentic-framework" className="w-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <AgenticFrameworkPage />
                </Suspense>
              </div>
            )}

            {currentTab === 'kernel-core' && (
              <div id="tab-kernel-core" className="w-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <KernelCorePage />
                </Suspense>
              </div>
            )}

            {currentTab === 'ppe-engine' && (
              <div id="tab-ppe-engine" className="w-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <ProjectPrioritizationEnginePage />
                </Suspense>
              </div>
            )}

            {currentTab === 'portfolio' && (
              <div id="tab-portfolio" className="w-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <PortfolioPage />
                </Suspense>
              </div>
            )}

            {currentTab === 'regional-planning' && (
              <div id="tab-regional-planning" className="w-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <RegionalPlanningPage />
                </Suspense>
              </div>
            )}

            {currentTab === 'territorial-gis' && (
              <div id="tab-territorial-gis" className="w-full h-full animate-fade-in">
                <Suspense fallback={<PageFallback />}>
                  <TerritorialWebGISPage focusProvince={gisFocusProvince} />
                </Suspense>
              </div>
            )}

            {currentTab === 'transactions' && (
              <div id="tab-transactions" className="flex flex-col gap-6 animate-fade-in">
                <div className="bg-brand-800 text-white p-6 rounded-2xl flex flex-col gap-2">
                  <h2 className="text-lg font-bold">مدیریت جامع اسناد مالی و حوالجات کشور</h2>
                  <p className="text-xs text-brand-100/80 leading-relaxed">
                    در این بخش می‌توانید کلیه اسناد اعم از تزریق نقدینگی، مصارف دستگاه‌ها، ابلاغ بودجه استانی و حواله‌های ارزی را به صورت برخط مدیریت، جستجو و تایید نهایی کنید.
                  </p>
                </div>
                <RecentTransactions 
                  transactions={transactions}
                  onAddTransaction={handleAddTransaction}
                  onDeleteTransaction={handleDeleteTransaction}
                  searchQuery={searchQuery}
                />
              </div>
            )}

            {currentTab === 'analytics' && (
              <div id="tab-analytics" className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-fade-in text-right">
                <div className="md:col-span-2">
                  <Suspense fallback={<PageFallback />}>
                    <SciPopulationPanel />
                  </Suspense>
                </div>
                <div className="md:col-span-2">
                  <CashFlowChart />
                </div>
                <CategoryDonut totalExpenses={totalExpenses} />
                <div className="bg-surface border border-line rounded-2xl p-5 flex flex-col gap-4">
                  <h3 className="text-sm font-bold text-ink-800">تحلیل بهینه‌سازی بودجه حاکمیتی</h3>
                  <div className="flex flex-col gap-3.5 text-xs text-ink-500 leading-relaxed">
                    <p>
                      سیستم هوشمند تحلیل ریسک و ناترازی آرا رفتارهای تخصیصی شما را برای سال مالی جاری بررسی نمود. سهم هزینه‌های عمرانی زیرساخت در صدر ردیف‌های فعال است که تضمین‌کننده رشد ناخالص داخلی به میزان هدف‌گذاری مصوب می‌باشد.
                    </p>
                    <div className="p-3 bg-brand-100 text-brand-800 rounded-xl flex gap-2">
                      <TrendingUp size={16} className="shrink-0" />
                      <p className="text-[11px] font-semibold text-right">
                        پیشنهاد شبیه‌ساز آرا: تخصیص مازاد درآمدهای صادراتی نفت و گاز به کلان‌پروژه توسعه پایدار انرژی‌های تجدیدپذیر اصفهان جهت تسریع در تکمیل شبکه سراسری.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentTab === 'wallet' && (
              <div id="tab-wallet" className="grid grid-cols-1 md:grid-cols-12 gap-8 animate-fade-in text-right">
                <div className="md:col-span-4">
                  <WalletCard 
                    totalBalance={totalBalance}
                    totalExpenses={totalExpenses}
                    onDeposit={handleDeposit}
                    onTransfer={handleTransfer}
                    onFilterHistory={() => {}}
                  />
                </div>
                <div className="md:col-span-8 bg-surface border border-line rounded-2xl p-6 flex flex-col gap-4">
                  <h2 className="text-sm font-bold text-brand-800">پیوست‌های فنی خزانه متمرکز ملی</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs mt-2">
                    <div className="p-3 bg-surface border border-line rounded-xl flex flex-col gap-1">
                      <span className="text-ink-500">نوع درگاه</span>
                      <span className="font-bold text-ink-800">حساب جاری ارزی خزانه کل کشور</span>
                    </div>
                    <div className="p-3 bg-surface border border-line rounded-xl flex flex-col gap-1">
                      <span className="text-ink-500">شماره ردیف بودجه</span>
                      <span className="font-bold text-ink-800 font-mono">CH93 0000 8500 1529 4430 1</span>
                    </div>
                    <div className="p-3 bg-surface border border-line rounded-xl flex flex-col gap-1">
                      <span className="text-ink-500">ارز تسویه پایانی</span>
                      <span className="font-bold text-ink-800">دلار ایالات متحده</span>
                    </div>
                    <div className="p-3 bg-surface border border-line rounded-xl flex flex-col gap-1">
                      <span className="text-ink-500">نهاد ناظر بانکی</span>
                      <span className="font-bold text-ok">فعال (بانک مرکزی جمهوری اسلامی ایران)</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {currentTab === 'users' && (
              <div id="tab-users" className="flex flex-col gap-6 animate-fade-in text-right">
                <div className="bg-surface border border-line rounded-2xl p-5 flex flex-col gap-4">
                  <h2 className="text-sm font-bold text-ink-800">کارگزاران و ناظران تایید شده کشور</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {initialGovernanceLogs.map((u) => (
                      <div key={u.id} className="p-4 border border-line rounded-xl flex items-center gap-3.5 hover:border-signal-400 transition-colors text-right">
                        <img src={u.userAvatar} alt={u.userName} className="w-10 h-10 rounded-full object-cover border border-line" />
                        <div className="flex flex-col">
                          <span className="text-xs font-bold text-ink-800">{u.userName}</span>
                          <span className="text-[10px] text-ink-500 mt-0.5">{u.role}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentTab === 'settings' && (
              <div id="tab-settings" className="bg-surface border border-line rounded-2xl p-6 flex flex-col gap-6 animate-fade-in text-right">
                <h2 className="text-sm font-bold text-brand-800">تنظیمات عمومی سامانه آرا</h2>
                <div className="flex flex-col gap-4 max-w-md">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-ink-500">مبنای آماری ارز ملی</label>
                    <select className="bg-paper border border-line rounded-lg p-2.5 text-xs text-ink-800">
                      <option>میلیون دلار</option>
                      <option>میلیارد تومان</option>
                      <option>یورو</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-ink-500">زبان پیش‌فرض سامانه حاکمیتی</label>
                    <select className="bg-paper border border-line rounded-lg p-2.5 text-xs text-ink-800">
                      <option>فارسی (پیش‌فرض)</option>
                      <option>انگلیسی (چپ‌به‌راست)</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor="font-variant-select" className="text-xs text-ink-500">قلم رابط کاربری</label>
                    <select
                      id="font-variant-select"
                      value={fontVariant}
                      onChange={(e) => applyFontVariant(e.target.value as FontVariant)}
                      className="cursor-pointer bg-paper border border-line rounded-lg p-2.5 text-xs text-ink-800"
                    >
                      <option value="standard">وزیرمتن (استاندارد)</option>
                      <option value="round-dots">وزیرمتن گرد (Round-Dots)</option>
                    </select>
                    <span className="text-[10px] text-ink-400">انتخاب شما به‌صورت خودکار در همین مرورگر ذخیره می‌شود.</span>
                  </div>
                  <div className="flex items-center justify-between border-t border-line pt-4 mt-2">
                    <span className="text-xs text-ink-800 font-semibold">ارسال ایمیل خلاصه پایش پایداری به کارگزاران</span>
                    <input type="checkbox" defaultChecked className="w-4 h-4 accent-brand-800" />
                  </div>
                  <button 
                    onClick={() => alert('تغییرات با موفقیت در دیوان ثبت گردید.')}
                    className="mt-4 px-4 py-2.5 bg-brand-800 hover:bg-brand-700 text-signal-400 rounded-lg text-xs font-bold transition-colors cursor-pointer self-start"
                  >
                    ذخیره قطعی تنظیمات آرا
                  </button>
                </div>
              </div>
            )}
          </main>

          {/* Global Footer elements matching CSS variables */}
          <footer id="footer" className="w-full py-5 px-8 border-t border-line bg-surface flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-ink-500 select-none">
            <div className="flex items-center gap-2">
              <MapPin size={12} className="text-brand-800" />
              <span>حقوق مادی و معنوی متعلق به سامانه هوشمند حکمرانی کشور (آرا) می‌باشد © ۱۴۰۵</span>
            </div>
            
            <div className="flex items-center gap-5">
              <a href="#privacy" className="hover:text-brand-800 transition-colors">قوانین امنیت اطلاعات</a>
              <a href="#terms" className="hover:text-brand-800 transition-colors">سند منشور کاربری حاکمیت</a>
              <a href="#contact" className="hover:text-brand-800 transition-colors">دیوان محاسبات عالی</a>
            </div>

            {/* Social media anchors formatted beautifully as requested in CSS */}
            <div id="social-logos" className="flex items-center gap-3">
              <a href="#facebook" className="text-ink-300 hover:text-brand-800 transition-colors" title="فیسبوک"><Facebook size={16} /></a>
              <a href="#twitter" className="text-ink-300 hover:text-brand-800 transition-colors" title="توییتر"><Twitter size={16} /></a>
              <a href="#instagram" className="text-ink-300 hover:text-brand-800 transition-colors" title="اینستاگرام"><Instagram size={16} /></a>
              <a href="#youtube" className="text-ink-300 hover:text-brand-800 transition-colors" title="یوتیوب"><Youtube size={16} /></a>
              <a href="#linkedin" className="text-ink-300 hover:text-brand-800 transition-colors" title="لینکدین"><Linkedin size={16} /></a>
            </div>
          </footer>
        </div>
      </div>

      {/* Persian AI Sina Chat Panel Overlay */}
      <AIChatModal 
        isOpen={isAIChatOpen} 
        onClose={() => setIsAIChatOpen(false)} 
        totalBalance={totalBalance}
        totalExpenses={totalExpenses}
      />
    </div>
  );
}
