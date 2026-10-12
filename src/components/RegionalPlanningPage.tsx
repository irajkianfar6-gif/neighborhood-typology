import React, { useState, useMemo, useEffect } from 'react';
import { 
  Bot,
  SlidersHorizontal, 
  MapPin, 
  Map,
  Grid3x3,
  ListFilter,
  Target, 
  ArrowRightLeft, 
  GitCompare, 
  Search, 
  Sparkles, 
  Share2, 
  Copy, 
  Save, 
  RefreshCw, 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  HelpCircle, 
  Info, 
  ChevronDown, 
  ChevronUp, 
  ChevronLeft, 
  ChevronRight, 
  Zap, 
  BarChart3, 
  TrendingUp, 
  Check, 
  X, 
  Users, 
  ShieldCheck, 
  Droplets, 
  Sun, 
  Briefcase, 
  Building2, 
  Volume2, 
  Eye, 
  Compass, 
  Network,
  Maximize2,
  Minimize2,
  FileText,
  Lock,
  Layers3,
  Award,
  ArrowUpRight,
  Plus
} from 'lucide-react';
import { MatchCriterion, MatchCandidate, SupplyItem, DemandItem } from '../types';
import { recordEvent } from '../lib/archiveDB';
import { IRAN_PROVINCES, IRAN_WATERS, IRAN_VIEWBOX, getPathLabelAnchor } from '../data/iranProvincePaths';
import { chatWithAIJSON } from '../lib/aiService';
import { getHakimGrounding } from '../lib/hakimGrounding';
import { buildRegionalNLQMessages, localRegionalNLQFallback, type RegionalNLQResult } from '../lib/regionalExplain';

// ==========================================
// INITIAL DATA & PRESETS
// ==========================================

export const initialCriteria: MatchCriterion[] = [
  // 1. Natural Capability (قابلیت طبیعی)
  { id: 'crit-water', familyId: 'natural', familyName: 'قابلیت طبیعی', name: 'سرانه آب تجدیدپذیر و پتانسیل آبخوان', weight: 85, direction: 'max', isHardConstraint: true, hardConstraintThreshold: 450, dataSource: 'سازمان مدیریت منابع آب ایران' },
  { id: 'crit-soil', familyId: 'natural', familyName: 'قابلیت طبیعی', name: 'مرغوبیت خاک و استعداد اراضی', weight: 60, direction: 'max', isHardConstraint: false, dataSource: 'سازمان امور اراضی کشور' },
  { id: 'crit-solar', familyId: 'natural', familyName: 'قابلیت طبیعی', name: 'شدت تابش خورشیدی و انرژی پاک', weight: 70, direction: 'max', isHardConstraint: false, dataSource: 'سازمان ساتبا' },
  { id: 'crit-hazard', familyId: 'natural', familyName: 'قابلیت طبیعی', name: 'خطر فرونشست زمین و مخاطرات طبیعی', weight: 75, direction: 'min', isHardConstraint: true, hardConstraintThreshold: 12, dataSource: 'سازمان زمین‌شناسی' },

  // 2. Infrastructure & Access (زیرساخت و دسترسی)
  { id: 'crit-power', familyId: 'infra', familyName: 'زیرساخت و دسترسی', name: 'ظرفیت مازاد شبکه توزیع برق و گاز', weight: 70, direction: 'max', isHardConstraint: false, dataSource: 'وزارت نیرو و نفت' },
  { id: 'crit-transit', familyId: 'infra', familyName: 'زیرساخت و دسترسی', name: 'تراکم راه‌ها و دسترسی به محور ترانزیتی/ریل', weight: 65, direction: 'max', isHardConstraint: false, dataSource: 'وزارت راه و شهرسازی' },
  { id: 'crit-telecom', familyId: 'infra', familyName: 'زیرساخت و دسترسی', name: 'پوشش اینترنت پهن‌باند و فیبر نوری', weight: 50, direction: 'max', isHardConstraint: false, dataSource: 'وزارت ارتباطات' },

  // 3. Human & Social Capital (سرمایه انسانی و اجتماعی)
  { id: 'crit-skill', familyId: 'human', familyName: 'سرمایه انسانی و اجتماعی', name: 'تراکم نیروی متخصص و مهارت بومی', weight: 75, direction: 'max', isHardConstraint: false, dataSource: 'سازمان فنی و حرفه‌ای' },
  { id: 'crit-pop', familyId: 'human', familyName: 'سرمایه انسانی و اجتماعی', name: 'نرخ جمعیت فعال و جوانی هرم سنی', weight: 55, direction: 'max', isHardConstraint: false, dataSource: 'مرکز آمار ایران' },
  { id: 'crit-social-cap', familyId: 'human', familyName: 'سرمایه انسانی و اجتماعی', name: 'شاخص انسجام و سرمایه اجتماعی منطقه', weight: 45, direction: 'max', isHardConstraint: false, dataSource: 'پیمایش ملی سرمایه اجتماعی' },

  // 4. Economics & Market (اقتصاد و بازار)
  { id: 'crit-agglomeration', familyId: 'economy', familyName: 'اقتصاد و بازار', name: 'صرفه مقیاس و همجواری با خوشه‌های موجود', weight: 80, direction: 'max', isHardConstraint: false, dataSource: 'سازمان صنایع کوچک' },
  { id: 'crit-market-dist', familyId: 'economy', familyName: 'اقتصاد و بازار', name: 'فاصله تا بازارهای مصرف کلان و بنادر صادراتی', weight: 65, direction: 'max', isHardConstraint: false, dataSource: 'گمرک و اتاق بازرگانی' },

  // 5. Institutional & Legal (نهادی و حقوقی)
  { id: 'crit-zoning', familyId: 'legal', familyName: 'نهادی و حقوقی', name: 'انطباق با سند کاربری و پهنه‌بندی مصوب', weight: 90, direction: 'max', isHardConstraint: true, hardConstraintThreshold: 1, dataSource: 'دبیرخانه شورای‌عالی آمایش' },
  { id: 'crit-permits', familyId: 'legal', familyName: 'نهادی و حقوقی', name: 'سرعت صدور مجوزها و مشوق‌های سرمایه‌گذاری', weight: 50, direction: 'max', isHardConstraint: false, dataSource: 'درگاه ملی مجوزها' },

  // 6. Equity & National Priority (عدالت و اولویت ملی)
  { id: 'crit-deprivation', familyId: 'equity', familyName: 'عدالت و اولویت', name: 'درجه محرومیت منطقه (شاخص MPI)', weight: 85, direction: 'max', isHardConstraint: false, dataSource: 'سازمان برنامه و بودجه' },
  { id: 'crit-national-target', familyId: 'equity', familyName: 'عدالت و اولویت', name: 'همراستایی با اهداف کلان برنامه هفتم توسعه', weight: 70, direction: 'max', isHardConstraint: false, dataSource: 'موتور اهداف آرا' },
];

export const initialCandidates: MatchCandidate[] = [
  {
    id: 'cand-neyriz-ferro',
    cellCode: 'C31-NEY',
    cellName: 'شهرستان نی‌ریز (دشت قطرویه)',
    province: 'فارس',
    lat: 29.20,
    lng: 54.32,
    planId: 'plan-ferro',
    planTitle: 'خوشه صنعتی فرو-کروم و متالورژی پیشرفته',
    category: 'صنعت و معدن',
    totalScore: 88.4,
    confidence: 94,
    scores: {
      'crit-water': 52,
      'crit-soil': 70,
      'crit-solar': 85,
      'crit-hazard': 30, // low hazard = good
      'crit-power': 80,
      'crit-transit': 85,
      'crit-telecom': 75,
      'crit-skill': 78,
      'crit-pop': 82,
      'crit-social-cap': 80,
      'crit-agglomeration': 92,
      'crit-market-dist': 70,
      'crit-zoning': 100,
      'crit-permits': 85,
      'crit-deprivation': 88,
      'crit-national-target': 95,
    },
    isEliminated: false,
    blockers: [
      { id: 'b1', title: 'کمبود ۲ مگاوات توان برق پایدار در فاز ۲', severity: 'medium', solution: 'احداث احداث نیروگاه خورشیدی ۵ مگاواتی خرد در جوار کارخانه', complementaryProject: 'P-02 نیروگاه خورشیدی آباده‌طشک' },
      { id: 'b2', title: 'محدودیت تخصیص آب تازه کشاورزی', severity: 'high', solution: 'استفاده ۱۰۰٪ از پساب تصفیه‌شده شهری نی‌ریز و بازچرخانی صنعتی', complementaryProject: 'طرح خط انتقال پساب شهری نی‌ریز' }
    ],
    enablerScore: 94.2,
    enablers: [
      { id: 'e1', title: 'اتصال به خط لوله انتقال پساب شهری', cost: 4.2, scoreBoost: 4.0 },
      { id: 'e2', title: 'احداث نیروگاه خورشیدی تجدیدپذیر اختصاصی', cost: 8.5, scoreBoost: 3.8 }
    ],
    capitalNeeded: 145,
    jobsCreated: 680,
    waterImpact: 'بازچرخانی ۹۲٪ - صفر برداشت از آبخوان',
    timeToROI: '۳.۴ سال',
    evidence: [
      { location: 'خوشه فروکروم اسفراین', successRate: 88, note: 'تحقق ۱۰۲٪ اهداف صادراتی و اشتغال منطقه' },
      { location: 'مجموعه متالورژی نی‌ریز فاز ۱', successRate: 92, note: 'تأمین زنجیره فولاد استان فارس با ارزش افزوده ۳.۲ برابری' }
    ],
    spillovers: [
      { targetCell: 'بخش پشتکوه (C32)', effect: '+۱۸٪ تقاضای خدمات فنی و زنجیره تامین', strength: 'high' },
      { targetCell: 'استهبان (C12)', effect: '+۸٪ اشتغال غیرمستقیم حمل و نقل', strength: 'med' }
    ]
  },
  {
    id: 'cand-isfahan-solar',
    cellCode: 'C21-ISF',
    cellName: 'دشت کوهپایه اصفهان (اراضی شور)',
    province: 'اصفهان',
    lat: 32.71,
    lng: 52.43,
    planId: 'plan-solar',
    planTitle: 'ابرنیروگاه خورشیدی فتوولتائیک ۲۰۰ مگاواتی',
    category: 'انرژی پاک',
    totalScore: 84.1,
    confidence: 91,
    scores: {
      'crit-water': 95, // solar doesn't need water
      'crit-soil': 40,
      'crit-solar': 98,
      'crit-hazard': 15,
      'crit-power': 95,
      'crit-transit': 88,
      'crit-telecom': 80,
      'crit-skill': 85,
      'crit-pop': 75,
      'crit-social-cap': 70,
      'crit-agglomeration': 80,
      'crit-market-dist': 90,
      'crit-zoning': 100,
      'crit-permits': 90,
      'crit-deprivation': 60,
      'crit-national-target': 92,
    },
    isEliminated: false,
    blockers: [
      { id: 'b3', title: 'تاخیر در استعلام سازمان منابع طبیعی اراضی', severity: 'low', solution: 'تسریع از طریق درگاه ملی مجوزها و کارگروه زیربنایی استان', complementaryProject: 'سند تخصیص اراضی ملی اصفهان' }
    ],
    enablerScore: 89.0,
    enablers: [
      { id: 'e3', title: 'احداث پست ترانسفورماتور ۴۰۰ کیلوولت مجاور', cost: 12.0, scoreBoost: 4.9 }
    ],
    capitalNeeded: 85,
    jobsCreated: 240,
    waterImpact: 'بدون نیاز به آب عملیاتی (شستشوی رباتیک خشک)',
    timeToROI: '۴.۱ سال',
    evidence: [
      { location: 'مزرعه خورشیدی آباده', successRate: 94, note: 'تولید سالانه ۱۸۰ میلیون کیلووات ساعت برق پاک' }
    ],
    spillovers: [
      { targetCell: 'شهرک صنعتی سجزی', effect: '+۲۵٪ پایداری ولتاژ شبکه صنایع', strength: 'high' }
    ]
  },
  {
    id: 'cand-khuzestan-agro',
    cellCode: 'C14-KHZ',
    cellName: 'دشت شادگان و خرمشهر',
    province: 'خوزستان',
    lat: 30.65,
    lng: 48.66,
    planId: 'plan-pistachio',
    planTitle: 'مجتمع کشت هوشمند پسته و گیاهان مقاوم به شوری',
    category: 'کشاورزی نوین',
    totalScore: 76.8,
    confidence: 88,
    scores: {
      'crit-water': 68,
      'crit-soil': 82,
      'crit-solar': 88,
      'crit-hazard': 25,
      'crit-power': 65,
      'crit-transit': 78,
      'crit-telecom': 60,
      'crit-skill': 70,
      'crit-pop': 85,
      'crit-social-cap': 75,
      'crit-agglomeration': 60,
      'crit-market-dist': 85,
      'crit-zoning': 90,
      'crit-permits': 70,
      'crit-deprivation': 92,
      'crit-national-target': 80,
    },
    isEliminated: false,
    blockers: [
      { id: 'b4', title: 'نوسان EC آب زهکش در ماه‌های گرم سال', severity: 'high', solution: 'نصب سیستم آب‌شیرین‌کن اسمز معکوس صنعتی خورشیدی', complementaryProject: 'طرح زهکشی هوشمند کارون' }
    ],
    enablerScore: 85.5,
    enablers: [
      { id: 'e4', title: 'نصب سنسورهای رطوبت خاک و آبیاری قطره‌ای زیرسطحی', cost: 3.5, scoreBoost: 8.7 }
    ],
    capitalNeeded: 32,
    jobsCreated: 850,
    waterImpact: 'کاهش ۶۰٪ مصرف نسبت به کشت‌های سنتی',
    timeToROI: '۵.۲ سال',
    evidence: [
      { location: 'مزارع پسته شور رفسنجان', successRate: 82, note: 'ارزآوری ۴.۵ میلیون دلار در سال پنجم' }
    ],
    spillovers: [
      { targetCell: 'روستاهای حوزه تالاب شادگان', effect: 'جلوگیری از مهاجرت ۳۵۰ خانوار روستایی', strength: 'high' }
    ]
  },
  {
    id: 'cand-sistan-wind',
    cellCode: 'C09-SIS',
    cellName: 'دشت میل نادر سیستان',
    province: 'سیستان و بلوچستان',
    lat: 31.02,
    lng: 61.50,
    planId: 'plan-wind',
    planTitle: 'مزرعه بادی و نیروگاه ترکیبی تجدیدپذیر میل نادر',
    category: 'انرژی پاک',
    totalScore: 79.2,
    confidence: 86,
    scores: {
      'crit-water': 90,
      'crit-soil': 30,
      'crit-solar': 95,
      'crit-hazard': 40, // wind hazard
      'crit-power': 70,
      'crit-transit': 60,
      'crit-telecom': 55,
      'crit-skill': 50,
      'crit-pop': 80,
      'crit-social-cap': 85,
      'crit-agglomeration': 50,
      'crit-market-dist': 60,
      'crit-zoning': 100,
      'crit-permits': 80,
      'crit-deprivation': 98,
      'crit-national-target': 90,
    },
    isEliminated: false,
    blockers: [
      { id: 'b5', title: 'فاصله تا شبکه اصلی خط انتقال ۲۳۰ کیلوولت', severity: 'medium', solution: 'احداث خط انتقال ۴۵ کیلومتری میل نادر به زابل', complementaryProject: 'خط انتقال برق زابل' }
    ],
    enablerScore: 87.1,
    enablers: [
      { id: 'e5', title: 'احداث خط انتقال برق اختصاصی', cost: 18.0, scoreBoost: 7.9 }
    ],
    capitalNeeded: 110,
    jobsCreated: 310,
    waterImpact: 'صفر مصرف آب',
    timeToROI: '۴.۸ سال',
    evidence: [
      { location: 'توربین‌های بادی خواف', successRate: 90, note: 'ضریب ظرفیت ۵۲٪ که در جهان کم‌نظیر است' }
    ],
    spillovers: [
      { targetCell: 'شهرستان زابل', effect: 'تأمین برق ۵۰ هزار خانوار محروم مرزی', strength: 'high' }
    ]
  },
  {
    id: 'cand-marvdasht-petro',
    cellCode: 'C05-MRV',
    cellName: 'دشت مرودشت (حوزه کامفیروز)',
    province: 'فارس',
    lat: 29.87,
    lng: 52.80,
    planId: 'plan-petro',
    planTitle: 'مجتمع پتروشیمی سنگین پایه گاز',
    category: 'پتروشیمی',
    totalScore: 32.0,
    confidence: 96,
    scores: {
      'crit-water': 10, // Failed hard constraint!
      'crit-soil': 90,
      'crit-solar': 60,
      'crit-hazard': 85,
      'crit-power': 80,
      'crit-transit': 90,
      'crit-telecom': 85,
      'crit-skill': 80,
      'crit-pop': 70,
      'crit-social-cap': 50,
      'crit-agglomeration': 85,
      'crit-market-dist': 75,
      'crit-zoning': 0, // Failed zoning constraint
      'crit-permits': 20,
      'crit-deprivation': 40,
      'crit-national-target': 30,
    },
    isEliminated: true,
    eliminationReason: 'نقض قید سخت آبخوان (کمتر از ۴۵۰ مترمکعب سرانه) و مخالفت زیست‌محیطی حوضه تخت جمشید',
    blockers: [
      { id: 'b6', title: 'تخریب شدید آبخوان و تشدید فرونشست تاریخی', severity: 'high', solution: 'غیرقابل اجرا — انتقال طرح به سواحل مکران پیشنهاد می‌شود', complementaryProject: 'انتقال طرح به هاب پتروشیمی چابهار' }
    ],
    enablerScore: 35.0,
    enablers: [],
    capitalNeeded: 320,
    jobsCreated: 450,
    waterImpact: 'برداشت سالانه ۴.۲ میلیون مترمکعب (بحران‌زا)',
    timeToROI: '۶.۵ سال',
    evidence: [],
    spillovers: [
      { targetCell: 'حوزه تخت جمشید', effect: 'تهدید فرونشست برای آثار ثبت جهانی', strength: 'high' }
    ]
  }
];

export const initialSupplies: SupplyItem[] = [
  { id: 'sup-1', title: 'خط اعتباری ویژه صندوق توسعه ملی', owner: 'حاکمیت / دولت', type: 'capital', value: '۵۰۰ میلیون دلار', capacityLimit: 500, matchedDemandIds: ['dem-1', 'dem-2'] },
  { id: 'sup-2', title: 'فناوری آبیاری هوشمند سنسوری', owner: 'شرکت دانش‌بنیان آرا تک', type: 'tech', value: 'پوشش ۵۰,۰۰۰ هکتار', capacityLimit: 50, matchedDemandIds: ['dem-1'] },
  { id: 'sup-3', title: 'ظرفیت مازاد برق نیروگاهی خورشیدی', owner: 'وزارت نیرو / ساتبا', type: 'capacity', value: '۳۰۰ مگاوات', capacityLimit: 300, matchedDemandIds: ['dem-2'] },
  { id: 'sup-4', title: 'بسته مشوق مالیاتی مناطق محروم', owner: 'سازمان امور مالیاتی', type: 'incentive', value: 'معافیت ۱۰ ساله', capacityLimit: 100, matchedDemandIds: ['dem-1', 'dem-3'] }
];

export const initialDemands: DemandItem[] = [
  { id: 'dem-1', cellName: 'نی‌ریز (قطرویه)', province: 'فارس', title: 'ناترازی شدید آبخوان و نیاز به کشت کم‌آب‌بر', category: 'کشاورزی و محیط زیست', urgency: 'critical', deprivationLevel: 78, requiredCapital: 45, matchedSupplyIds: ['sup-1', 'sup-2'] },
  { id: 'dem-2', cellName: 'دشت کوهپایه اصفهان', province: 'اصفهان', title: 'کمبود شدید برق صنایع و فرونشست زمین', category: 'انرژی و زیرساخت', urgency: 'high', deprivationLevel: 52, requiredCapital: 85, matchedSupplyIds: ['sup-1', 'sup-3'] },
  { id: 'dem-3', cellName: 'شادگان و خرمشهر', province: 'خوزستان', title: 'نرخ بیکاری بالای جوانان و شورشدن خاک', category: 'اشتغال و رفاه', urgency: 'critical', deprivationLevel: 88, requiredCapital: 32, matchedSupplyIds: ['sup-1', 'sup-4'] }
];

// Preset Weight Profiles
export const weightPresets = [
  { id: 'preset-balanced', name: 'پیش‌فرض متوازن آرا', desc: 'تعادل بین اقتصاد، محیط‌زیست و رفاه اجتماعی', weights: { 'crit-water': 85, 'crit-deprivation': 85, 'crit-agglomeration': 80, 'crit-zoning': 90 } },
  { id: 'preset-economic', name: 'حداکثر بازده اقتصادی', desc: 'اولویت بر صرفه مقیاس، بازار و زیرساخت موجود', weights: { 'crit-water': 50, 'crit-agglomeration': 95, 'crit-market-dist': 90, 'crit-transit': 85 } },
  { id: 'preset-equity', name: 'عدالت‌محور و رفع محرومیت', desc: 'اولویت بر مناطق محروم و ایجاد اشتغال بومی', weights: { 'crit-deprivation': 100, 'crit-skill': 80, 'crit-pop': 85, 'crit-national-target': 90 } },
  { id: 'preset-water', name: 'پایداری آب‌محور و اقلیم', desc: 'سخت‌گیری حداکثری بر منابع آب و مخاطرات طبیعی', weights: { 'crit-water': 100, 'crit-hazard': 95, 'crit-solar': 85, 'crit-zoning': 95 } },
  { id: 'preset-fast', name: 'سریع‌الاجرا و کم‌ریسک', desc: 'اولویت بر مجوزهای آماده و زمینه‌های زیرساختی', weights: { 'crit-permits': 90, 'crit-power': 85, 'crit-transit': 80, 'crit-agglomeration': 75 } }
];

// ==========================================
// MAIN COMPONENT
// ==========================================

export default function RegionalPlanningPage() {
  // Page Mode Switch
  // Mode 1: Cell -> Opportunity (سلول ← فرصت)
  // Mode 2: Plan -> Place (طرح ← مکان)
  // Mode 3: Two-Sided Market (بازار دوسویه)
  const [matchMode, setMatchMode] = useState<'cell-to-opp' | 'plan-to-place' | 'two-sided'>('cell-to-opp');

  // Domain Scope Selection
  const [domainScope, setDomainScope] = useState<string>('Z2-county');

  // Canvas View Mode
  const [canvasView, setCanvasView] = useState<'map' | 'matrix' | 'list'>('map');

  // Fullscreen Canvas (بوم انطباق سرزمینی)
  const [isCanvasFullscreen, setIsCanvasFullscreen] = useState<boolean>(false);

  useEffect(() => {
    if (!isCanvasFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsCanvasFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [isCanvasFullscreen]);

  // Criteria & Weights
  const [criteria, setCriteria] = useState<MatchCriterion[]>(initialCriteria);
  const [activePreset, setActivePreset] = useState<string>('preset-balanced');

  // Candidates & Selection
  const [candidates] = useState<MatchCandidate[]>(initialCandidates);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string>('cand-neyriz-ferro');

  // Compare Candidates (up to 4)
  const [compareIds, setCompareIds] = useState<string[]>(['cand-neyriz-ferro', 'cand-isfahan-solar']);

  // Two-Sided Market state
  const [supplies] = useState<SupplyItem[]>(initialSupplies);
  const [demands] = useState<DemandItem[]>(initialDemands);
  const [isOptimizerRunning, setIsOptimizerRunning] = useState<boolean>(false);

  // Modals & Drawers
  const [isNLQOpen, setIsNLQOpen] = useState<boolean>(false);
  const [nlqQuery, setNlqQuery] = useState<string>('');
  const [isEliminatedModalOpen, setIsEliminatedModalOpen] = useState<boolean>(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState<boolean>(false);
  const [isVersionTreeOpen, setIsVersionTreeOpen] = useState<boolean>(false);
  const [isSpyLensActive, setIsSpyLensActive] = useState<boolean>(false);
  const [spyLensLayer, setSpyLensLayer] = useState<'deprivation' | 'water' | 'soil'>('water');
  const [specialRole, setSpecialRole] = useState<'executive' | 'workshop' | 'investor' | 'equity' | 'auditor'>('executive');
  const [ttsPlaying, setTtsPlaying] = useState<boolean>(false);

  // ── نتیجهٔ پرس‌وجوی هوشمند حکیم (NLQ) ────────────────────
  const [nlqResult, setNlqResult] = useState<RegionalNLQResult | null>(null);
  const [nlqLoading, setNlqLoading] = useState(false);
  const [nlqLocal, setNlqLocal] = useState(false);
  const [nlqError, setNlqError] = useState<string | null>(null);
  const [nlqCopied, setNlqCopied] = useState(false);

  // Active Selected Candidate computed
  const selectedCandidate = useMemo(() => {
    return candidates.find(c => c.id === selectedCandidateId) || candidates[0];
  }, [candidates, selectedCandidateId]);

  // مرکز هندسی استان‌های واقعی نقشه (برای پین‌ها و هایلایت‌ها)
  const provinceCenters = useMemo(() => {
    const map: Record<string, { x: number; y: number }> = {};
    // لنگرگاه مشترک: مرکز سطحِ داخل چندضلعی (fallback: مرکز bbox)
    IRAN_PROVINCES.forEach((p) => { map[p.kpi] = getPathLabelAnchor(p.d); });
    return map;
  }, []);

  // Recalculate candidate scores dynamically when weights change
  const scoredCandidates = useMemo(() => {
    const totalWeightSum = criteria.reduce((sum, cr) => sum + cr.weight, 0);

    return candidates.map(cand => {
      // Check hard constraints
      let isEliminated = cand.isEliminated;
      let eliminationReason = cand.eliminationReason;

      criteria.forEach(cr => {
        if (cr.isHardConstraint && cr.hardConstraintThreshold !== undefined) {
          const val = cand.scores[cr.id] ?? 50;
          if (cr.direction === 'max' && val < cr.hardConstraintThreshold) {
            isEliminated = true;
            eliminationReason = `نقض قید سخت ${cr.name} (مقدار: ${val} کمتر از آستانه ${cr.hardConstraintThreshold})`;
          } else if (cr.direction === 'min' && val > cr.hardConstraintThreshold) {
            isEliminated = true;
            eliminationReason = `نقض قید سخت ${cr.name} (مقدار: ${val} بیش از حد مجاز ${cr.hardConstraintThreshold})`;
          }
        }
      });

      // Calculate weighted average score
      let weightedSum = 0;
      criteria.forEach(cr => {
        const val = cand.scores[cr.id] ?? 50;
        weightedSum += val * cr.weight;
      });

      const computedScore = totalWeightSum > 0 ? Math.round((weightedSum / totalWeightSum) * 10) / 10 : cand.totalScore;

      return {
        ...cand,
        totalScore: isEliminated ? Math.min(computedScore, 35) : computedScore,
        isEliminated,
        eliminationReason
      };
    }).sort((a, b) => b.totalScore - a.totalScore);
  }, [candidates, criteria]);

  // Count eliminated candidates
  const eliminatedCount = useMemo(() => {
    return scoredCandidates.filter(c => c.isEliminated).length;
  }, [scoredCandidates]);

  // Handle weight slider change with debounced feel
  const handleWeightChange = (critId: string, newWeight: number) => {
    setActivePreset('custom');
    setCriteria(prev => prev.map(c => c.id === critId ? { ...c, weight: newWeight } : c));
  };

  // Apply preset profile
  const handleApplyPreset = (presetId: string) => {
    const preset = weightPresets.find(p => p.id === presetId);
    if (!preset) return;
    setActivePreset(presetId);

    setCriteria(prev => prev.map(c => {
      const pWeight = (preset.weights as Record<string, number>)[c.id];
      if (pWeight !== undefined) {
        return { ...c, weight: pWeight };
      }
      return c;
    }));
  };

  // Handle Toggle Compare
  const handleToggleCompare = (id: string) => {
    if (compareIds.includes(id)) {
      setCompareIds(compareIds.filter(i => i !== id));
    } else {
      if (compareIds.length >= 4) {
        alert('حداکثر ۴ انطباق را می‌توانید همزمان مقایسه کنید.');
        return;
      }
      setCompareIds([...compareIds, id]);
    }
  };

  // Run Optimal Allocation Optimizer
  const handleRunOptimizer = () => {
    setIsOptimizerRunning(true);
    setTimeout(() => {
      setIsOptimizerRunning(false);
      alert('تخصیص بهینه با موفقیت محاسبه گردید. امتیاز کل سبد به ۹۱.۲٪ ارتقا یافت.');
    }, 1200);
  };

  // Process Natural Language Search Query — حکیم (بر پایهٔ محرک‌های توسعهٔ منطقه‌ای)
  const handleProcessNLQ = async () => {
    if (!nlqQuery.trim() || nlqLoading) return;
    const q = nlqQuery.trim();
    setIsNLQOpen(false);
    setNlqResult(null);
    setNlqLoading(true);
    setNlqError(null);
    setNlqLocal(false);

    try {
      const grounding = await getHakimGrounding();
      const { system, user } = buildRegionalNLQMessages(q, criteria, candidates, grounding);
      const data = await chatWithAIJSON<RegionalNLQResult>(
        [{ role: 'user', content: user }],
        { system, maxTokens: 1400, timeoutMs: 150000 },
      );
      const knownCriteria = new Set(criteria.map((c) => c.id));
      const knownCandidates = new Set(candidates.map((c) => c.id));
      const validPreset =
        typeof data.suggestedPreset === 'string' &&
        ['preset-balanced', 'preset-economic', 'preset-equity', 'preset-water', 'preset-fast'].includes(data.suggestedPreset)
          ? (data.suggestedPreset as RegionalNLQResult['suggestedPreset'])
          : null;
      void recordEvent('nlq', 'پرس‌وجوی طبیعی منطق‌های', `«${q.slice(0, 60)}» — ${data.recommendedCandidateIds?.length ?? 0} کاندید`, { refType: 'nlq' });
      setNlqResult({
        interpretation: typeof data.interpretation === 'string' ? data.interpretation : '',
        matchedDrivers: Array.isArray(data.matchedDrivers)
          ? data.matchedDrivers
              .filter((d) => d && typeof d.code === 'string' && typeof d.name === 'string')
              .map((d) => ({
                code: d.code,
                name: d.name,
                cluster: typeof d.cluster === 'string' ? d.cluster : '',
                relevance: typeof d.relevance === 'string' ? d.relevance : '',
              }))
          : [],
        suggestedPreset: validPreset,
        weightAdjustments: Array.isArray(data.weightAdjustments)
          ? data.weightAdjustments
              .filter((a) => a && typeof a.criterionId === 'string' && knownCriteria.has(a.criterionId) && Number.isFinite(a.delta))
              .map((a) => ({ criterionId: a.criterionId, delta: Math.max(-100, Math.min(100, a.delta)), reason: typeof a.reason === 'string' ? a.reason : '' }))
          : [],
        recommendedCandidateIds: Array.isArray(data.recommendedCandidateIds)
          ? data.recommendedCandidateIds.filter((id) => typeof id === 'string' && knownCandidates.has(id))
          : [],
        reasoning: typeof data.reasoning === 'string' ? data.reasoning : '',
        risks: Array.isArray(data.risks) ? data.risks.map(String) : [],
      });
    } catch (err) {
      setNlqLocal(true);
      setNlqResult(localRegionalNLQFallback(q, criteria, candidates));
      setNlqError(err instanceof Error ? err.message : 'خطای نامشخص');
      void recordEvent('nlq', 'پرس‌وجوی طبیعی منطق‌های (محلی)', `«${q.slice(0, 60)}» — سرویس برخط در دسترس نبود`, { refType: 'nlq' });
    } finally {
      setNlqLoading(false);
    }
  };

  // اعمال پیشنهادهای حکیم روی وزن‌های موتور تطبیق
  const handleApplyNLQSuggestions = () => {
    if (!nlqResult) return;
    if (nlqResult.suggestedPreset) handleApplyPreset(nlqResult.suggestedPreset);
    const adjustments = nlqResult.weightAdjustments.filter((a) => criteria.some((c) => c.id === a.criterionId));
    if (adjustments.length > 0) {
      setCriteria((prev) =>
        prev.map((c) => {
          const adj = adjustments.find((a) => a.criterionId === c.id);
          return adj ? { ...c, weight: Math.min(100, Math.max(0, c.weight + adj.delta)) } : c;
        }),
      );
      setActivePreset('custom');
    }
  };

  // کپی متن تحلیل NLQ
  const copyNLQ = async () => {
    if (!nlqResult) return;
    const bullets = (arr: string[]) => arr.map((s) => `• ${s}`).join('\n');
    const recs = candidates
      .filter((c) => nlqResult.recommendedCandidateIds.includes(c.id))
      .map((c) => `• ${c.cellName} (${c.province}) — ${c.planTitle} — امتیاز ${c.totalScore}`)
      .join('\n');
    const text = [
      `تحلیل پرس‌و‌جوی حکیم: «${nlqQuery}»`,
      '',
      `تفسیر: ${nlqResult.interpretation}`,
      nlqResult.matchedDrivers.length ? `محرک‌های مرتبط:\n${nlqResult.matchedDrivers.map((d) => `• ${d.code} ${d.name} (${d.cluster}) — ${d.relevance}`).join('\n')}` : '',
      nlqResult.suggestedPreset ? `پروفایل پیشنهادی: ${nlqResult.suggestedPreset}` : '',
      nlqResult.weightAdjustments.length ? `تنظیم وزن‌ها:\n${nlqResult.weightAdjustments.map((a) => `• ${a.criterionId} ${a.delta > 0 ? '+' : ''}${a.delta} — ${a.reason}`).join('\n')}` : '',
      recs ? `کاندیدهای پیشنهادی:\n${recs}` : '',
      `استدلال: ${nlqResult.reasoning}`,
      nlqResult.risks.length ? `ملاحظات:\n${bullets(nlqResult.risks)}` : '',
      '',
      '— تولیدشده توسط حکیم · سامانه آرا (ISGP) —',
    ]
      .filter((l) => l.trim().length > 0)
      .join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setNlqCopied(true);
      window.setTimeout(() => setNlqCopied(false), 2000);
    } catch {
      // دسترسی به کلیپ‌بورد مسدود بود
    }
  };

  // Play TTS
  const handleToggleTTS = () => {
    setTtsPlaying(!ttsPlaying);
  };

  return (
    <div dir="rtl" className="w-full flex flex-col gap-4 text-ink-800 font-sans antialiased pb-12 select-none">
      
      {/* ==========================================
          ROW 0: STICKY MATCH MODE BAR (64px)
          ========================================== */}
      <div id="match-mode-bar" className="sticky top-0 z-30 bg-gradient-to-r from-brand-800 via-brand-900 to-brand-900 text-white p-3 rounded-2xl shadow-xl border border-signal-400/20 flex flex-wrap items-center justify-between gap-3 backdrop-blur-md">
        
        {/* Left Side: 3-Way Mode Switch Pills */}
        <div className="flex items-center gap-1.5 bg-black/25 p-1 rounded-xl border border-white/10">
          <button
            onClick={() => setMatchMode('cell-to-opp')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              matchMode === 'cell-to-opp'
                ? 'bg-signal-400 text-brand-900 shadow-md font-black scale-[1.02]'
                : 'text-slate-200 hover:text-white hover:bg-surface/10'
            }`}
          >
            <MapPin size={14} />
            <span>سلول ← فرصت</span>
          </button>

          <button
            onClick={() => setMatchMode('plan-to-place')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              matchMode === 'plan-to-place'
                ? 'bg-signal-400 text-brand-900 shadow-md font-black scale-[1.02]'
                : 'text-slate-200 hover:text-white hover:bg-surface/10'
            }`}
          >
            <Target size={14} />
            <span>طرح ← مکان</span>
          </button>

          <button
            onClick={() => setMatchMode('two-sided')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              matchMode === 'two-sided'
                ? 'bg-signal-400 text-brand-900 shadow-md font-black scale-[1.02]'
                : 'text-slate-200 hover:text-white hover:bg-surface/10'
            }`}
          >
            <ArrowRightLeft size={14} />
            <span>بازار دوسویه (عرضه و تقاضا)</span>
          </button>
        </div>

        {/* Center: Domain & Scope Selector */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-signal-400 font-bold hidden sm:inline">دامنه تحلیلی:</span>
          <select 
            value={domainScope}
            onChange={(e) => setDomainScope(e.target.value)}
            className="bg-surface/10 hover:bg-surface/15 border border-white/20 text-white text-xs rounded-xl px-3 py-1.5 focus:outline-none focus:border-signal-400 cursor-pointer"
          >
            <option value="L0-national" className="bg-brand-800 text-white">سطح L0 - کل کشور</option>
            <option value="L1-region" className="bg-brand-800 text-white">سطح L1 - منطقه جنوب‌شرق</option>
            <option value="L2-province" className="bg-brand-800 text-white">سطح L2 - استان فارس</option>
            <option value="Z2-county" className="bg-brand-800 text-white">سطح Z2 - شهرستان نی‌ریز (کاهش ناترازی)</option>
            <option value="L4-district" className="bg-brand-800 text-white">سطح L4 - بخش قطرویه و پشتکوه</option>
            <option value="L5-cell" className="bg-brand-800 text-white">سطح L5 - سلول پایه ۱۰ کیلومتری</option>
          </select>
        </div>

        {/* Right Side: Natural Language Query, Save, Fork, Data Integrity Badge */}
        <div className="flex items-center gap-2">
          
          {/* NLQ Button */}
          <button
            onClick={() => setIsNLQOpen(true)}
            className="flex items-center gap-1.5 bg-surface/10 hover:bg-surface/20 text-signal-400 px-3 py-1.5 rounded-xl text-xs font-bold border border-white/15 transition-all cursor-pointer"
            title="پرس‌وجوی زبان طبیعی هوشمند"
          >
            <Sparkles size={14} className="animate-pulse" />
            <span className="hidden md:inline">پرس‌وجوی هوشمند</span>
          </button>

          {/* Fork & Version Button */}
          <button
            onClick={() => setIsVersionTreeOpen(true)}
            className="flex items-center gap-1.5 bg-surface/10 hover:bg-surface/20 text-white px-3 py-1.5 rounded-xl text-xs font-bold border border-white/15 transition-all cursor-pointer"
            title="شجره نسخه مسائل و انشعاب"
          >
            <GitCompare size={14} />
            <span className="hidden lg:inline">نسخه بختگان ۲.۱</span>
          </button>

          {/* Data Integrity Badge */}
          <div className="hidden xl:flex items-center gap-2 bg-black/30 px-3 py-1 rounded-xl border border-white/10 text-[10.5px]">
            <span className="w-2 h-2 rounded-full bg-signal-400 animate-pulse" />
            <span className="text-slate-200">پوشش داده: <strong className="text-signal-400">۹۶.۴٪</strong></span>
            <span className="text-ink-400">|</span>
            <span className="text-ink-300">به‌روزرسانی: ۳ ساعت قبل</span>
          </div>

        </div>

      </div>

      {/* ==========================================
          ROW 1: MATCH SUMMARY STRIP (5 KPI CARDS)
          ========================================== */}
      <div id="match-summary-strip" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        
        {/* Card 1: Eligible Candidates */}
        <div 
          onClick={() => setIsEliminatedModalOpen(true)}
          className="bg-surface border border-line hover:border-brand-800 p-3.5 rounded-2xl flex flex-col justify-between gap-2 shadow-xs transition-all cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-500 font-bold">کاندیدهای واجد شرایط</span>
            <span className="w-7 h-7 rounded-lg bg-brand-100 text-brand-800 flex items-center justify-center font-bold text-xs group-hover:scale-110 transition-transform">
              <CheckCircle2 size={16} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-ink-800">۱۸ سلول</span>
            {eliminatedCount > 0 && (
              <span className="text-[10px] text-danger bg-danger-soft border border-danger/40 px-1.5 py-0.5 rounded-md font-bold">
                {eliminatedCount} حذف‌شده
              </span>
            )}
          </div>
          <span className="text-[10px] text-brand-800 font-semibold underline decoration-dashed">
            مشاهده دلایل حذف قید سخت ←
          </span>
        </div>

        {/* Card 2: Best Match Score */}
        <div className="bg-surface border border-line p-3.5 rounded-2xl flex flex-col justify-between gap-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-500 font-bold">بهترین امتیاز انطباق</span>
            <span className="w-7 h-7 rounded-lg bg-ok-soft text-ok flex items-center justify-center font-bold text-xs">
              <Award size={16} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-ok">
              {scoredCandidates[0]?.totalScore || 88.4}٪
            </span>
            <span className="text-[10px] text-ok bg-ok-soft px-1.5 py-0.5 rounded-md font-black">
              سطح عالی (رتبه اول)
            </span>
          </div>
          <span className="text-[10px] text-ink-500 truncate">
            {scoredCandidates[0]?.cellName || 'نی‌ریز (قطرویه)'}
          </span>
        </div>

        {/* Card 3: Estimated Absorption Capacity */}
        <div className="bg-surface border border-line p-3.5 rounded-2xl flex flex-col justify-between gap-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-500 font-bold">ظرفیت جذب سرمایه</span>
            <span className="w-7 h-7 rounded-lg bg-info-soft text-info flex items-center justify-center font-bold text-xs">
              <Briefcase size={16} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-ink-800">۲,۴۵۰</span>
            <span className="text-xs text-ink-500 font-bold">میلیارد تومان</span>
          </div>
          <span className="text-[10px] text-info font-semibold">
            معادل ۶۵.۲ میلیون دلار مصوب
          </span>
        </div>

        {/* Card 4: Dominant Risk */}
        <div className="bg-surface border border-line p-3.5 rounded-2xl flex flex-col justify-between gap-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-500 font-bold">ریسک غالب منطقه</span>
            <span className="w-7 h-7 rounded-lg bg-warn-soft text-warn flex items-center justify-center font-bold text-xs">
              <AlertTriangle size={16} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-black text-warn truncate">تنش هیدرولوژیک</span>
            <span className="text-[10px] text-warn bg-warn-soft px-1.5 py-0.5 rounded-md font-bold">
              شاخص ۰.۷۹
            </span>
          </div>
          <span className="text-[10px] text-ink-500">
            نیازمند پروژه تکمیلی پساب
          </span>
        </div>

        {/* Card 5: Data Quality & Stability */}
        <div className="bg-surface border border-line p-3.5 rounded-2xl flex flex-col justify-between gap-2 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs text-ink-500 font-bold">پایداری رتبه و کیفیت</span>
            <span className="w-7 h-7 rounded-lg bg-brand-50 text-brand-600 flex items-center justify-center font-bold text-xs">
              <ShieldCheck size={16} />
            </span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xl font-black text-brand-900">۹۲٪</span>
            <span className="text-[10px] text-brand-700 bg-brand-100 px-1.5 py-0.5 rounded-md font-black">
              ثبات با ±۲۰٪ نوسان
            </span>
          </div>
          <span className="text-[10px] text-ink-500">
            اعتبارسنجی تاریخی
          </span>
        </div>

      </div>

      {/* ── نتیجهٔ پرس‌و‌جوی هوشمند حکیم (NLQ) ────────────────── */}
      {nlqResult && (
        <div className="bg-surface border border-brand-800/25 rounded-2xl p-4 flex flex-col gap-3 shadow-sm animate-fade-in">
          {/* سربرگ */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-col">
              <h3 className="text-xs font-black text-ink-800 flex items-center gap-1.5">
                <Sparkles size={14} className="text-brand-800" /> تحلیل پرس‌و‌جوی حکیم
                <span className="text-[8px] font-black bg-gradient-to-l from-brand-900 to-brand-700 text-signal-400 rounded-full px-2 py-0.5">حکیم</span>
              </h3>
              <p className="text-[9.5px] text-ink-400 font-semibold mt-0.5">بر پایهٔ محرک‌های توسعهٔ منطقه‌ای کاتالوگ مادر — «{nlqQuery}»</p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleApplyNLQSuggestions}
                disabled={nlqLoading || (!nlqResult.suggestedPreset && nlqResult.weightAdjustments.length === 0)}
                className="flex items-center gap-1 rounded-xl bg-brand-800 hover:bg-brand-700 text-signal-400 px-3 py-2 text-[9.5px] font-black transition-all cursor-pointer active:scale-95 disabled:opacity-50 shadow-sm"
                title="اعمال پروفایل و تنظیم وزن‌های پیشنهادی روی موتور تطبیق"
              >
                <Zap size={12} /> اعمال وزن‌های پیشنهادی
              </button>
              <button
                onClick={() => void copyNLQ()}
                disabled={nlqLoading}
                className="flex items-center gap-1 rounded-lg border border-line px-2.5 py-2 text-[9px] font-black text-ink-600 hover:border-brand-300 hover:text-brand-800 transition-all cursor-pointer disabled:opacity-50"
              >
                {nlqCopied ? <Check size={11} className="text-ok-700" /> : <Copy size={11} />} {nlqCopied ? 'کپی شد' : 'کپی تحلیل'}
              </button>
              <button
                onClick={() => setNlqResult(null)}
                className="p-1.5 -m-1 rounded-lg text-ink-400 hover:text-danger hover:bg-danger-soft transition-all cursor-pointer"
                title="بستن"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {nlqLoading && (
            <div className="flex flex-col items-center gap-2.5 py-7">
              <Bot size={22} className="text-brand-700 animate-pulse" />
              <p className="text-[10px] font-black text-ink-500">حکیم در حال انطباق پرس‌و‌جو با محرک‌های توسعهٔ منطقه‌ای است…</p>
              <p className="text-[8.5px] font-semibold text-ink-400">تفسیر پرس‌و‌جو · شناسایی محرک‌های علّی · پیشنهاد وزن‌ها و کاندیدها</p>
            </div>
          )}

          {!nlqLoading && nlqResult && (
            <div className="flex flex-col gap-2.5">
              {nlqResult.interpretation && (
                <p className="text-[10px] font-bold text-ink-700 leading-relaxed rounded-xl border border-brand-800/15 bg-brand-50/60 px-3 py-2.5">{nlqResult.interpretation}</p>
              )}

              {nlqResult.matchedDrivers.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><TrendingUp size={11} className="text-brand-700" /> محرک‌های توسعهٔ منطقه‌ای مرتبط</span>
                  <div className="flex flex-wrap gap-1.5">
                    {nlqResult.matchedDrivers.map((d, i) => (
                      <span key={i} className="text-[8.5px] font-bold text-ink-600 bg-paper border border-line rounded-full px-2.5 py-1">
                        <span className="font-black text-brand-800" dir="ltr">{d.code}</span> {d.name}
                        <span className="text-ink-400"> — {d.cluster}</span>
                        {d.relevance ? <span className="text-ink-500"> ({d.relevance})</span> : null}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {nlqResult.suggestedPreset && (
                  <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper/60 p-2.5">
                    <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><SlidersHorizontal size={11} className="text-brand-700" /> پروفایل وزنی پیشنهادی</span>
                    <span className="text-[9.5px] font-black text-brand-800" dir="ltr">{nlqResult.suggestedPreset}</span>
                  </div>
                )}
                {nlqResult.weightAdjustments.length > 0 && (
                  <div className="flex flex-col gap-1 rounded-xl border border-line bg-paper/60 p-2.5">
                    <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><SlidersHorizontal size={11} className="text-teal-600" /> تنظیم وزن معیارها</span>
                    <div className="flex flex-wrap gap-1">
                      {nlqResult.weightAdjustments.map((a, i) => (
                        <span key={i} className="text-[8.5px] font-bold text-ink-600 bg-surface border border-line rounded-full px-2 py-0.5" title={a.reason}>
                          <span dir="ltr">{a.criterionId}</span> <span className={a.delta >= 0 ? 'text-ok-700' : 'text-danger'}>{a.delta > 0 ? '+' : ''}{a.delta}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {nlqResult.recommendedCandidateIds.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><Target size={11} className="text-brand-700" /> کاندیدهای پیشنهادی</span>
                  <div className="flex flex-wrap gap-1.5">
                    {candidates
                      .filter((c) => nlqResult.recommendedCandidateIds.includes(c.id))
                      .map((c) => (
                        <span key={c.id} className="text-[8.5px] font-bold text-ink-700 bg-ok-soft border border-ok/30 rounded-full px-2.5 py-1">
                          {c.cellName} ({c.province}) — امتیاز {c.totalScore}
                        </span>
                      ))}
                  </div>
                </div>
              )}

              {nlqResult.reasoning && (
                <div className="rounded-xl border border-line bg-paper/60 p-2.5 flex flex-col gap-1">
                  <span className="text-[9px] font-black text-ink-600 flex items-center gap-1"><Info size={11} className="text-teal-600" /> استدلال</span>
                  <p className="text-[9.5px] font-semibold text-ink-700 leading-relaxed">{nlqResult.reasoning}</p>
                </div>
              )}

              {nlqResult.risks.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {nlqResult.risks.map((r, i) => (
                    <span key={i} className="text-[8.5px] font-bold text-danger-700 bg-danger-soft border border-danger/25 rounded-full px-2.5 py-1">{r}</span>
                  ))}
                </div>
              )}

              {nlqLocal && (
                <p className="text-[8.5px] font-bold text-amber-700 bg-amber-50 border border-amber-300/50 rounded-lg px-2 py-1.5">
                  ⚠ سرویس برخط در دسترس نبود؛ این تحلیل بر پایهٔ قواعد قطعی و به‌صورت محلی تولید شد.
                </p>
              )}
              {nlqError && !nlqLocal && <p className="text-[8.5px] font-bold text-danger">{nlqError}</p>}
            </div>
          )}
        </div>
      )}

      {/* ==========================================
          MAIN BODY: 3-COLUMN RESPONSIVE LAYOUT
          ========================================== */}
      {matchMode !== 'two-sided' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          
          {/* ==========================================
              RIGHT PANEL (~24% / 3 cols): CRITERIA & WEIGHTS
              ========================================== */}
          <div className="lg:col-span-3 flex flex-col gap-3 bg-surface border border-line rounded-2xl p-4 shadow-xs">
            
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <SlidersHorizontal size={18} className="text-brand-800" />
                <h2 className="text-xs font-bold text-ink-800">پنل معیارها و وزن‌دهی</h2>
              </div>
              <button
                onClick={() => handleApplyPreset('preset-balanced')}
                className="text-[10px] text-brand-800 hover:underline font-bold flex items-center gap-1 cursor-pointer"
              >
                <RefreshCw size={11} />
                <span>بازنشانی</span>
              </button>
            </div>

            {/* Weight Preset Picker */}
            <div className="flex flex-col gap-1.5">
              <label className="text-[11px] font-bold text-ink-500">پیش‌تنظیم‌های سیاستی:</label>
              <div className="grid grid-cols-1 gap-1">
                {weightPresets.map(preset => (
                  <button
                    key={preset.id}
                    onClick={() => handleApplyPreset(preset.id)}
                    className={`text-right p-2 rounded-xl border text-xs transition-all cursor-pointer ${
                      activePreset === preset.id
                        ? 'bg-brand-800 text-signal-400 border-brand-800 font-bold shadow-xs'
                        : 'bg-surface hover:bg-brand-100/50 text-ink-800 border-line'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{preset.name}</span>
                      {activePreset === preset.id && <Check size={14} className="text-signal-400" />}
                    </div>
                    <p className="text-[9.5px] opacity-80 mt-0.5 line-clamp-1">{preset.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            {/* Criteria Accordion / Slider List */}
            <div className="flex flex-col gap-3 mt-1 max-h-[500px] overflow-y-auto pr-1">
              <span className="text-[11px] font-bold text-ink-500">وزن و آستانه‌های حذف (۱۶ معیار):</span>
              
              {criteria.map((crit) => (
                <div key={crit.id} className="p-2.5 bg-surface border border-line rounded-xl flex flex-col gap-2 hover:border-brand-800/40 transition-colors">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-ink-800 leading-snug">{crit.name}</span>
                    <span className="text-xs font-black text-brand-800 font-mono bg-brand-100 px-2 py-0.5 rounded-md">
                      {crit.weight}٪
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <input 
                      type="range" 
                      min="0" 
                      max="100" 
                      value={crit.weight} 
                      onChange={(e) => handleWeightChange(crit.id, Number(e.target.value))}
                      className="w-full accent-brand-800 h-1.5 bg-line rounded-lg cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between text-[10px] text-ink-500 pt-1 border-t border-line/60">
                    <div className="flex items-center gap-1">
                      <span className="px-1.5 py-0.2 rounded bg-paper text-ink-700 font-bold">
                        {crit.familyName}
                      </span>
                      {crit.isHardConstraint && (
                        <span className="px-1.5 py-0.2 rounded bg-danger-soft text-danger font-black" title="قید سخت - حذف قطعی">
                          قید سخت
                        </span>
                      )}
                    </div>
                    <span className="text-[9px] text-ink-500 truncate max-w-[110px]" title={crit.dataSource}>
                      {crit.dataSource}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Hard Constraint Elimination Summary Footer */}
            {eliminatedCount > 0 && (
              <button
                onClick={() => setIsEliminatedModalOpen(true)}
                className="w-full p-2.5 bg-danger-soft hover:bg-danger-soft text-danger border border-danger/40 rounded-xl text-xs font-bold flex items-center justify-between transition-colors cursor-pointer"
              >
                <div className="flex items-center gap-1.5">
                  <AlertTriangle size={15} className="text-danger" />
                  <span>{eliminatedCount} کاندید به دلیل قید سخت حذف شد</span>
                </div>
                <span className="text-[10px] underline">چرا؟</span>
              </button>
            )}

          </div>

          {/* ==========================================
              CENTER PANEL (~50% / 6 cols): MATCH CANVAS
              ========================================== */}
          <div
            className={`lg:col-span-6 flex flex-col gap-3 bg-surface border border-line rounded-2xl p-4 shadow-xs min-h-[620px] transition-all duration-300 ${
              isCanvasFullscreen ? 'fixed inset-0 z-50 overflow-y-auto' : ''
            }`}
          >
            
            {/* Canvas View Switcher Header with Radio Toolbar */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-line pb-3.5 bg-gradient-to-r from-slate-50/80 via-white to-slate-50/80 p-3 rounded-2xl border border-line">
              <div className="flex items-center gap-2.5">
                <div className="p-2 bg-brand-800 text-signal-400 rounded-xl shadow-xs">
                  <Compass size={18} />
                </div>
                <div>
                  <h2 className="text-xs font-black text-ink-800">بوم انطباق سرزمینی</h2>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-ok-soft animate-pulse" />
                    <span className="text-[10px] text-ink-500 font-semibold">
                      انتخاب فعال: <strong className="text-brand-800">{selectedCandidate?.cellName}</strong>
                    </span>
                  </div>
                </div>
              </div>

              {/* Radio Buttons Segmented Control Toolbar + Fullscreen */}
              <div className="flex flex-wrap items-center gap-2">
              <div 
                role="radiogroup" 
                aria-label="انتخاب نمای بوم انطباق"
                className="flex flex-wrap items-center gap-1 bg-paper p-1.5 rounded-xl border border-line"
              >
                {/* Radio 1: Suitability-Map */}
                <label
                  onClick={() => setCanvasView('map')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                    canvasView === 'map'
                      ? 'bg-brand-800 text-signal-400 border-brand-800 shadow-md font-black scale-[1.02]'
                      : 'bg-surface text-ink-500 border-transparent hover:text-ink-800 hover:bg-paper'
                  }`}
                >
                  <input
                    type="radio"
                    name="canvasViewRadio"
                    checked={canvasView === 'map'}
                    onChange={() => setCanvasView('map')}
                    className="sr-only"
                  />
                  <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    canvasView === 'map' ? 'border-signal-400 bg-signal-400' : 'border-slate-400'
                  }`}>
                    {canvasView === 'map' && <span className="w-1.5 h-1.5 rounded-full bg-brand-800" />}
                  </span>
                  <Map size={14} />
                  <span>نقشه تناسب سرزمینی</span>
                </label>

                {/* Radio 2: Fit-Matrix */}
                <label
                  onClick={() => setCanvasView('matrix')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                    canvasView === 'matrix'
                      ? 'bg-brand-800 text-signal-400 border-brand-800 shadow-md font-black scale-[1.02]'
                      : 'bg-surface text-ink-500 border-transparent hover:text-ink-800 hover:bg-paper'
                  }`}
                >
                  <input
                    type="radio"
                    name="canvasViewRadio"
                    checked={canvasView === 'matrix'}
                    onChange={() => setCanvasView('matrix')}
                    className="sr-only"
                  />
                  <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    canvasView === 'matrix' ? 'border-signal-400 bg-signal-400' : 'border-slate-400'
                  }`}>
                    {canvasView === 'matrix' && <span className="w-1.5 h-1.5 rounded-full bg-brand-800" />}
                  </span>
                  <Grid3x3 size={14} />
                  <span>ماتریس انطباق</span>
                </label>

                {/* Radio 3: Ranked-List */}
                <label
                  onClick={() => setCanvasView('list')}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border ${
                    canvasView === 'list'
                      ? 'bg-brand-800 text-signal-400 border-brand-800 shadow-md font-black scale-[1.02]'
                      : 'bg-surface text-ink-500 border-transparent hover:text-ink-800 hover:bg-paper'
                  }`}
                >
                  <input
                    type="radio"
                    name="canvasViewRadio"
                    checked={canvasView === 'list'}
                    onChange={() => setCanvasView('list')}
                    className="sr-only"
                  />
                  <span className={`w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center transition-colors ${
                    canvasView === 'list' ? 'border-signal-400 bg-signal-400' : 'border-slate-400'
                  }`}>
                    {canvasView === 'list' && <span className="w-1.5 h-1.5 rounded-full bg-brand-800" />}
                  </span>
                  <ListFilter size={14} />
                  <span>فهرست رتبه‌بندی</span>
                </label>
              </div>

              {/* Fullscreen Canvas Toggle */}
              <button
                onClick={() => setIsCanvasFullscreen((f) => !f)}
                aria-pressed={isCanvasFullscreen}
                aria-label={isCanvasFullscreen ? 'خروج از تمام‌صفحه' : 'نمایش تمام‌صفحه'}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer border shadow-md ${
                  isCanvasFullscreen
                    ? 'bg-brand-800 text-signal-400 border-brand-800 active:scale-95'
                    : 'bg-surface text-ink-700 border-line-strong hover:bg-brand-100/60 hover:text-brand-800'
                }`}
                title={isCanvasFullscreen ? 'خروج از تمام‌صفحه (Esc)' : 'نمایش تمام‌صفحه'}
              >
                {isCanvasFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                <span className="hidden sm:inline">{isCanvasFullscreen ? 'خروج از تمام‌صفحه' : 'تمام‌صفحه'}</span>
              </button>
              </div>
            </div>

            {/* Dynamic View Container with Soft Fade-In Transition Effect */}
            <div key={canvasView} className="animate-fade-in flex flex-col gap-3 flex-grow relative transition-all duration-300 ease-in-out">

            {/* VIEW 1: MAP VIEW */}
            {canvasView === 'map' && (
              <div className="flex flex-col gap-3 flex-grow relative">
                
                {/* Spy-Lens Toggle Bar over Map */}
                <div className="flex items-center justify-between bg-surface p-2 rounded-xl border border-line text-xs">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsSpyLensActive(!isSpyLensActive)}
                      className={`px-2.5 py-1 rounded-lg font-bold text-[11px] transition-all cursor-pointer ${
                        isSpyLensActive ? 'bg-brand-800 text-signal-400' : 'bg-surface border border-line text-ink-500'
                      }`}
                    >
                      {isSpyLensActive ? '👁️ عدسی مقایسه‌ای فعال است' : '👁️ فعال‌سازی عدسی مقایسه‌ای'}
                    </button>

                    {isSpyLensActive && (
                      <select
                        value={spyLensLayer}
                        onChange={(e) => setSpyLensLayer(e.target.value as any)}
                        className="bg-surface border border-line rounded-lg px-2 py-0.5 text-[11px] text-ink-800 font-bold"
                      >
                        <option value="water">لایه پایه: تنش هیدرولوژیک آبخوان</option>
                        <option value="deprivation">لایه پایه: درجه محرومیت منطقه</option>
                        <option value="soil">لایه پایه: مرغوبیت اراضی و خاک</option>
                      </select>
                    )}
                  </div>

                  <span className="text-[10px] text-ink-500 hidden sm:inline">
                    برای مشاهده جزئیات کلیک کنید
                  </span>
                </div>

                {/* Interactive SVG Map Canvas */}
                <div className="w-full flex-grow min-h-[440px] bg-gradient-to-br from-brand-800/5 via-brand-800/10 to-brand-900/20 rounded-2xl border border-line relative overflow-hidden flex flex-col items-center justify-center p-3">
                  
                  {/* Decorative Map Grid Lines */}
                  <div className="absolute inset-0 opacity-15 bg-[radial-gradient(var(--color-brand-800)_1px,transparent_1px)] [background-size:16px_16px]" />

                  {/* نقشهٔ کامل و دقیق ایران (همان پایهٔ داشبورد) */}
                  <div className="relative w-full max-w-[620px]" style={{ aspectRatio: '1200 / 1070.6' }}>
                    
                    {/* Background Map Shape & Heatmap Layers */}
                    <svg viewBox={IRAN_VIEWBOX} className="absolute inset-0 w-full h-full filter drop-shadow-xl select-none" preserveAspectRatio="xMidYMid meet">
                      <defs>
                        {/* Land & Water Gradients */}
                        <linearGradient id="iran-land-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#F8FAFC" />
                          <stop offset="50%" stopColor="#EEF6EC" />
                          <stop offset="100%" stopColor="#DFEFE6" />
                        </linearGradient>

                        <linearGradient id="water-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                          <stop offset="0%" stopColor="#1E4841" stopOpacity="0.15" />
                          <stop offset="100%" stopColor="#132E29" stopOpacity="0.30" />
                        </linearGradient>

                        {/* Suitability Score Heatmap Glow Radial Gradients */}
                        <radialGradient id="glow-high" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor="#10B981" stopOpacity="0.75" />
                          <stop offset="50%" stopColor="#059669" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#047857" stopOpacity="0" />
                        </radialGradient>

                        <radialGradient id="glow-medium" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.75" />
                          <stop offset="60%" stopColor="#D97706" stopOpacity="0.3" />
                          <stop offset="100%" stopColor="#B45309" stopOpacity="0" />
                        </radialGradient>

                        <radialGradient id="glow-restricted" cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor="#EF4444" stopOpacity="0.8" />
                          <stop offset="60%" stopColor="#DC2626" stopOpacity="0.35" />
                          <stop offset="100%" stopColor="#991B1B" stopOpacity="0" />
                        </radialGradient>

                        {/* Hatched Pattern for Eliminated Hard Constraint Zones */}
                        <pattern id="hatched-red" width="10" height="10" patternTransform="rotate(45 0 0)" patternUnits="userSpaceOnUse">
                          <line x1="0" y1="0" x2="0" y2="10" stroke="#EF4444" strokeWidth="2.5" opacity="0.7" />
                        </pattern>

                        {/* Spy Lens Grid Layers */}
                        <pattern id="spy-water-grid" width="16" height="16" patternUnits="userSpaceOnUse">
                          <circle cx="8" cy="8" r="2" fill="#2563EB" opacity="0.35" />
                        </pattern>
                        <pattern id="spy-deprivation-grid" width="14" height="14" patternUnits="userSpaceOnUse">
                          <rect x="0" y="0" width="7" height="7" fill="#7C3AED" opacity="0.2" />
                        </pattern>
                      </defs>

                      {/* دریاها و جزایر واقعی نقشهٔ ایران */}
                      {IRAN_WATERS.map((w) => (
                        <path
                          key={w.id}
                          d={w.d}
                          fill="#BFDFE8"
                          stroke="#8FBCC9"
                          strokeWidth={0.9}
                          opacity={0.8}
                        />
                      ))}
                      <text x="478" y="120" fill="#1E4841" fontSize="15" fontWeight="bold" opacity="0.75">دریای خزر</text>
                      <text x="600" y="940" fill="#1E4841" fontSize="14" fontWeight="bold" opacity="0.75">خلیج فارس و دریای عمان</text>

                      {/* ۳۱ استان واقعی نقشهٔ ایران */}
                      <g id="iran-provinces-group">
                        {IRAN_PROVINCES.map((p) => (
                          <path
                            key={p.id}
                            id={`prov-${p.id}`}
                            d={p.d}
                            fill="#E5F0E1"
                            stroke="#1E4841"
                            strokeWidth={1.05}
                            strokeOpacity={0.85}
                          />
                        ))}
                      </g>

                      {/* عوارض طبیعی: دریاچه ارومیه، بختگان، کویر و رشته‌کوه‌ها */}
                      <path d="M 215 155 C 225 150, 230 165, 225 175 C 220 185, 210 170, 215 155 Z" fill="#3B82F6" opacity="0.75" stroke="#1D4ED8" strokeWidth="1" />
                      <text x="236" y="168" fill="#1D4ED8" fontSize="12" fontWeight="bold">دریاچه ارومیه</text>

                      <path d="M 600 690 Q 640 685 655 700 Q 635 715 600 690 Z" fill="#0EA5E9" opacity="0.85" stroke="#0284C7" strokeWidth="1" />
                      <text x="660" y="700" fill="#0284C7" fontSize="12" fontWeight="bold">حوضه بختگان</text>

                      <path d="M 640 330 C 755 305 875 380 840 500 C 735 525 650 420 640 330 Z" fill="#FDF6E2" opacity="0.65" stroke="#D97706" strokeWidth="1" strokeDasharray="3 3" />
                      <text x="720" y="410" fill="#B45309" fontSize="13" fontWeight="bold" opacity="0.85">دشت کویر و کویر لوت</text>

                      <path d="M 264 308 Q 408 495 576 776" fill="none" stroke="#1E4841" strokeWidth="2.5" strokeDasharray="6 4" opacity="0.4" />
                      <text x="300" y="400" fill="#1E4841" fontSize="13" fontWeight="bold" opacity="0.55" transform="rotate(-40 300 400)">رشته‌کوه زاگرس</text>

                      <path d="M 312 247 Q 504 261 720 247" fill="none" stroke="#1E4841" strokeWidth="2" strokeDasharray="5 3" opacity="0.4" />

                      {/* Heatmap Suitability Overlays (Radial Glow Highlights on Map) */}
                      <circle cx={provinceCenters.KHZ.x} cy={provinceCenters.KHZ.y} r="120" fill="url(#glow-high)" />

                      <circle cx={provinceCenters.ISF.x} cy={provinceCenters.ISF.y} r="105" fill="url(#glow-high)" />

                      <circle cx={provinceCenters.FAR.x + 20} cy={provinceCenters.FAR.y} r="95" fill="url(#glow-high)" />

                      <circle cx={provinceCenters.SIV.x} cy={provinceCenters.SIV.y} r="115" fill="url(#glow-medium)" />

                      <circle cx={provinceCenters.FAR.x - 45} cy={provinceCenters.FAR.y - 60} r="90" fill="url(#glow-restricted)" />
                      <rect
                        x={provinceCenters.FAR.x - 68}
                        y={provinceCenters.FAR.y - 88}
                        width="46"
                        height="56"
                        fill="url(#hatched-red)"
                        stroke="#EF4444"
                        strokeWidth="1.5"
                      />

                      {/* Spy-Lens Overlays — پوشش کامل نقشه (فضای مختصات ۱۲۰۰×۱۰۷۰) */}
                      {isSpyLensActive && spyLensLayer === 'water' && (
                        <rect x="0" y="0" width="1200" height="1070.6" fill="url(#spy-water-grid)" pointerEvents="none" />
                      )}
                      {isSpyLensActive && spyLensLayer === 'deprivation' && (
                        <rect x="0" y="0" width="1200" height="1070.6" fill="url(#spy-deprivation-grid)" pointerEvents="none" />
                      )}
                    </svg>

                    {/* Interactive Pin Markers Overlay on Top of Map Coordinates */}
                    {scoredCandidates.map((cand) => {
                      const isSelected = cand.id === selectedCandidateId;
                      
                      // موقعیت دقیق پین‌ها از مرکز هندسی استان‌های واقعی (نقشهٔ کامل ایران)
                      const posByCand: Record<string, { x: number; y: number }> = {
                        'cand-neyriz-ferro': provinceCenters.FAR,
                        'cand-isfahan-solar': provinceCenters.ISF,
                        'cand-khuzestan-agro': provinceCenters.KHZ,
                        'cand-sistan-wind': provinceCenters.SIV,
                        'cand-marvdasht-petro': { x: provinceCenters.FAR.x - 60, y: provinceCenters.FAR.y - 70 },
                      };
                      const pos = posByCand[cand.id] || { x: 600, y: 535 };
                      let top = `${(pos.y / 1070.6) * 100}%`;
                      let left = `${(pos.x / 1200) * 100}%`;

                      return (
                        <div
                          key={cand.id}
                          onClick={() => setSelectedCandidateId(cand.id)}
                          style={{ top, left }}
                          className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300 group z-20 ${
                            isSelected ? 'scale-125 z-30' : 'hover:scale-110'
                          }`}
                        >
                          {/* Pin Pulse */}
                          {isSelected && (
                            <span className="absolute -inset-2 rounded-full bg-brand-800/30 animate-ping" />
                          )}

                          {/* Pin Badge */}
                          <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl shadow-lg border text-xs font-black transition-all ${
                            cand.isEliminated
                              ? 'bg-danger text-white border-danger-700'
                              : isSelected
                                ? 'bg-brand-800 text-signal-400 border-signal-400'
                                : 'bg-surface text-ink-800 border-line group-hover:border-brand-800'
                          }`}>
                            <MapPin size={13} className={isSelected ? 'text-signal-400' : 'text-brand-800'} />
                            <span>{cand.cellName.split(' ')[0]}</span>
                            <span className={`text-[10px] px-1 py-0.2 rounded font-mono ${
                              cand.isEliminated ? 'bg-danger-700 text-white' : 'bg-brand-100 text-brand-800'
                            }`}>
                              {cand.totalScore}٪
                            </span>
                          </div>

                          {/* Hover Tooltip Card */}
                          <div className="absolute top-full mt-1 right-1/2 translate-x-1/2 hidden group-hover:flex flex-col bg-brand-900 text-white p-2.5 rounded-xl shadow-2xl text-[11px] whitespace-nowrap z-40 border border-signal-400/30">
                            <span className="font-bold text-signal-400">{cand.cellName}</span>
                            <span>طرح: {cand.planTitle}</span>
                            <span>امتیاز انطباق: {cand.totalScore}٪</span>
                            {cand.isEliminated && <span className="text-danger font-bold">❌ حذف شده (قید سخت)</span>}
                          </div>
                        </div>
                      );
                    })}

                    {/* Map Legend Overlay (Bottom Corner) */}
                    <div className="absolute bottom-3 right-3 bg-surface/90 backdrop-blur-md border border-line p-2.5 rounded-xl text-[10px] text-ink-800 flex flex-col gap-1.5 shadow-md z-10">
                      <span className="font-extrabold text-brand-800 border-b border-line pb-0.5">راهنمای تناسب سرزمینی</span>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-ok-soft shadow-xs" />
                        <span>تناسب بالا (امتیاز &gt; ۸۰٪)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-full bg-warn-soft shadow-xs" />
                        <span>تناسب متوسط (امتیاز ۶۰٪ - ۷۹٪)</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-3 h-3 rounded-sm bg-danger-soft/80 border border-danger/60" />
                        <span>منطقه حذف‌شده (قید سخت هیدرولوژیک)</span>
                      </div>
                    </div>

                    {/* Spy-Lens Overlay Indicator if active */}
                    {isSpyLensActive && (
                      <div className="absolute top-4 right-4 bg-brand-800/90 text-white px-3 py-1.5 rounded-xl text-xs font-bold border border-signal-400/40 backdrop-blur-md shadow-lg flex items-center gap-2 z-20">
                        <Eye size={14} className="text-signal-400 animate-pulse" />
                        <span>نمایش همزمان: امتیاز انطباق + {
                          spyLensLayer === 'water' ? 'تنش آبخوان' : spyLensLayer === 'deprivation' ? 'درجه محرومیت' : 'مرغوبیت خاک'
                        }</span>
                      </div>
                    )}

                  </div>

                </div>

              </div>
            )}

            {/* VIEW 2: FIT-MATRIX VIEW */}
            {canvasView === 'matrix' && (
              <div className="flex flex-col gap-3 flex-grow overflow-x-auto">
                <table className="w-full text-right text-xs border-collapse">
                  <thead>
                    <tr className="bg-brand-800 text-signal-400">
                      <th className="p-2.5 rounded-tr-xl font-bold">سلول / کاندید</th>
                      <th className="p-2.5 font-bold">طرح متناظر</th>
                      <th className="p-2.5 text-center font-bold">آب</th>
                      <th className="p-2.5 text-center font-bold">زیرساخت</th>
                      <th className="p-2.5 text-center font-bold">مهارت</th>
                      <th className="p-2.5 text-center font-bold">محرومیت</th>
                      <th className="p-2.5 text-center font-bold">نهادی</th>
                      <th className="p-2.5 rounded-tl-xl text-center font-bold">امتیاز کل</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scoredCandidates.map((cand) => {
                      const isSelected = cand.id === selectedCandidateId;
                      return (
                        <tr
                          key={cand.id}
                          onClick={() => setSelectedCandidateId(cand.id)}
                          className={`border-b border-line cursor-pointer transition-colors ${
                            isSelected ? 'bg-brand-100 font-bold' : 'hover:bg-paper'
                          }`}
                        >
                          <td className="p-2.5">
                            <div className="flex flex-col">
                              <span className="font-bold text-ink-800">{cand.cellName}</span>
                              <span className="text-[10px] text-ink-500">کد: {cand.cellCode}</span>
                            </div>
                          </td>
                          <td className="p-2.5 text-ink-500 max-w-[140px] truncate">{cand.planTitle}</td>
                          
                          {/* Score Cells with Heatmap Intensity Backgrounds */}
                          <td className="p-2.5 text-center font-mono font-bold bg-info-soft text-info">
                            {cand.scores['crit-water'] ?? 50}٪
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold bg-ok-soft text-ok">
                            {cand.scores['crit-power'] ?? 50}٪
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold bg-warn-soft text-warn">
                            {cand.scores['crit-skill'] ?? 50}٪
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold bg-brand-50 text-brand-900">
                            {cand.scores['crit-deprivation'] ?? 50}٪
                          </td>
                          <td className="p-2.5 text-center font-mono font-bold bg-paper text-ink-800">
                            {cand.scores['crit-zoning'] ?? 50}٪
                          </td>

                          <td className="p-2.5 text-center">
                            <span className={`px-2.5 py-1 rounded-lg font-black font-mono text-xs ${
                              cand.isEliminated
                                ? 'bg-danger-soft text-danger'
                                : 'bg-brand-800 text-signal-400'
                            }`}>
                              {cand.totalScore}٪
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* VIEW 3: RANKED LIST VIEW */}
            {canvasView === 'list' && (
              <div className="flex flex-col gap-2.5 flex-grow overflow-y-auto max-h-[520px]">
                {scoredCandidates.map((cand, idx) => {
                  const isSelected = cand.id === selectedCandidateId;
                  const isCompared = compareIds.includes(cand.id);

                  return (
                    <div
                      key={cand.id}
                      onClick={() => setSelectedCandidateId(cand.id)}
                      className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex flex-col gap-2.5 ${
                        cand.isEliminated
                          ? 'bg-danger-soft/60 border-danger/40'
                          : isSelected
                            ? 'bg-brand-100 border-brand-800 shadow-sm'
                            : 'bg-surface border-line hover:border-brand-800/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className={`w-6 h-6 rounded-lg flex items-center justify-center font-black text-xs ${
                            idx === 0 ? 'bg-brand-800 text-signal-400' : 'bg-line text-ink-800'
                          }`}>
                            #{idx + 1}
                          </span>
                          <div className="flex flex-col">
                            <span className="font-bold text-xs text-ink-800">{cand.cellName}</span>
                            <span className="text-[10px] text-ink-500">{cand.planTitle}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <span className={`px-2.5 py-1 rounded-xl text-xs font-black font-mono ${
                            cand.isEliminated
                              ? 'bg-danger text-white'
                              : 'bg-brand-800 text-signal-400'
                          }`}>
                            {cand.totalScore}٪
                          </span>

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleCompare(cand.id);
                            }}
                            className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-all ${
                              isCompared
                                ? 'bg-info text-white'
                                : 'bg-line text-ink-800 hover:bg-line-strong'
                            }`}
                          >
                            {isCompared ? '✓ در مقایسه' : '+ مقایسه'}
                          </button>
                        </div>
                      </div>

                      {/* Criteria Contribution Stacked Bar */}
                      <div className="flex items-center gap-1 w-full h-2 rounded-full overflow-hidden bg-line">
                        <div style={{ width: `${cand.scores['crit-water'] ?? 50}%` }} className="h-full bg-info-soft" title="سهم آب" />
                        <div style={{ width: `${cand.scores['crit-agglomeration'] ?? 50}%` }} className="h-full bg-ok-soft" title="سهم اقتصاد" />
                        <div style={{ width: `${cand.scores['crit-deprivation'] ?? 50}%` }} className="h-full bg-brand-500" title="سهم محرومیت" />
                      </div>

                      {/* Elimination reason if any */}
                      {cand.isEliminated && (
                        <span className="text-[10px] text-danger font-bold bg-danger-soft p-1.5 rounded-lg">
                          ❌ {cand.eliminationReason}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            </div>

          </div>

          {/* ==========================================
              LEFT PANEL (~26% / 3 cols): MATCH-DETAIL CARD
              ========================================== */}
          <div className="lg:col-span-3 flex flex-col gap-3 bg-surface border border-line rounded-2xl p-4 shadow-xs">
            
            {/* Header: Plan & Cell Selection */}
            <div className="border-b border-line pb-3 flex flex-col gap-1">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-brand-800 bg-brand-100 px-2 py-0.5 rounded-md">
                  کارت انطباق منتخب
                </span>
                <span className="text-xs font-black text-ok font-mono">
                  اطمینان: {selectedCandidate.confidence}٪
                </span>
              </div>
              <h3 className="text-sm font-black text-ink-800 mt-1">{selectedCandidate.cellName}</h3>
              <p className="text-xs text-ink-500 font-semibold">{selectedCandidate.planTitle}</p>
            </div>

            {/* Overall Score Badge */}
            <div className="bg-gradient-to-r from-brand-800 to-brand-900 text-white p-3.5 rounded-2xl flex items-center justify-between shadow-md">
              <div className="flex flex-col">
                <span className="text-[10px] text-signal-400 font-bold">امتیاز انطباق نهایی</span>
                <span className="text-2xl font-black text-signal-400 font-mono">
                  {selectedCandidate.totalScore} <span className="text-xs font-normal">از ۱۰۰</span>
                </span>
              </div>
              <div className="text-right flex flex-col items-end">
                <span className={`text-xs font-black px-2.5 py-1 rounded-xl ${
                  selectedCandidate.isEliminated
                    ? 'bg-danger text-white'
                    : selectedCandidate.totalScore >= 80
                      ? 'bg-signal-400 text-brand-900'
                      : 'bg-warn text-white'
                }`}>
                  {selectedCandidate.isEliminated ? 'حذف شده' : selectedCandidate.totalScore >= 80 ? 'انطباق عالی' : 'نیازمند تعدیل'}
                </span>
                <button
                  onClick={handleToggleTTS}
                  className="mt-1.5 text-[10px] text-signal-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <Volume2 size={12} />
                  <span>{ttsPlaying ? 'توقف خوانش' : 'روایت صوتی'}</span>
                </button>
              </div>
            </div>

            {/* Visual Radar Deficit Chart Representation */}
            <div className="bg-surface border border-line p-3 rounded-2xl flex flex-col gap-2">
              <span className="text-[11px] font-bold text-ink-800">نمودار رادار انطباق (کمبودها به قرمز):</span>
              
              <div className="space-y-1.5 text-xs">
                {criteria.slice(0, 5).map(cr => {
                  const val = selectedCandidate.scores[cr.id] ?? 50;
                  const isDeficit = val < 60;
                  return (
                    <div key={cr.id} className="flex flex-col gap-0.5">
                      <div className="flex justify-between text-[10.5px]">
                        <span className="text-ink-500 truncate max-w-[130px]">{cr.name}</span>
                        <span className={`font-mono font-bold ${isDeficit ? 'text-danger' : 'text-ok'}`}>
                          {val}٪
                        </span>
                      </div>
                      <div className="w-full bg-line h-1.5 rounded-full overflow-hidden">
                        <div 
                          style={{ width: `${val}%` }} 
                          className={`h-full rounded-full ${isDeficit ? 'bg-danger-soft' : 'bg-brand-800'}`} 
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Blockers & Enabler Bundle */}
            <div className="flex flex-col gap-2">
              <span className="text-[11px] font-bold text-ink-800">عوامل بازدارنده:</span>
              
              {selectedCandidate.blockers.map((b) => (
                <div key={b.id} className="p-2.5 bg-danger-soft border border-danger/40 rounded-xl flex flex-col gap-1 text-xs">
                  <div className="flex items-center justify-between text-danger font-bold">
                    <span>⚠️ {b.title}</span>
                    <span className="text-[9px] bg-danger-soft px-1.5 py-0.2 rounded">{b.severity}</span>
                  </div>
                  <p className="text-[10px] text-danger leading-tight">
                    <strong>راه حل:</strong> {b.solution}
                  </p>
                </div>
              ))}

              {/* Enabler Boost Button */}
              {selectedCandidate.enablers.length > 0 && (
                <div className="p-2.5 bg-brand-100 border border-signal-400 rounded-xl flex flex-col gap-1 text-xs mt-1">
                  <div className="flex items-center justify-between text-brand-800 font-bold">
                    <span>بسته پروژه مکمل</span>
                    <span className="font-mono text-ok font-black">
                      {selectedCandidate.totalScore}٪ ← {selectedCandidate.enablerScore}٪
                    </span>
                  </div>
                  <p className="text-[10px] text-ink-800">
                    با اجرای پروژه مکمل، امتیاز این انطباق به {selectedCandidate.enablerScore}٪ ارتقا می‌یابد.
                  </p>
                </div>
              )}
            </div>

            {/* Direct Action Buttons */}
            <div className="flex flex-col gap-1.5 mt-2 border-t border-line pt-3">
              <button 
                onClick={() => alert('انطباق به سناریوساز منتقل گردید.')}
                className="w-full py-2 bg-brand-800 hover:bg-brand-700 text-signal-400 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Zap size={14} />
                <span>ارسال مستقیم به سناریوساز</span>
              </button>

              <button 
                onClick={() => alert('انطباق در سبد پروژه‌های راهبردی کشور ثبت گردید.')}
                className="w-full py-2 bg-surface hover:bg-paper text-ink-800 border border-line rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center justify-center gap-1.5"
              >
                <Save size={14} />
                <span>ثبت قطعی در سبد پروژه‌ها</span>
              </button>
            </div>

          </div>

        </div>
      ) : (
        /* ==========================================
            TWO-SIDED MARKET BOARD (MODE 3)
            ========================================== */
        <div className="bg-surface border border-line rounded-2xl p-6 shadow-xs flex flex-col gap-6">
          
          <div className="flex items-center justify-between border-b border-line pb-4">
            <div>
              <h2 className="text-sm font-bold text-brand-800">تخته تخصیص بازار دوسویه</h2>
              <p className="text-xs text-ink-500">جفت‌سازی خودکار و بهینه منابع عرضه با تقاضای واقعی سلول‌ها</p>
            </div>

            <button
              onClick={handleRunOptimizer}
              disabled={isOptimizerRunning}
              className="px-4 py-2 bg-brand-800 hover:bg-brand-700 text-signal-400 rounded-xl text-xs font-bold shadow-md transition-all cursor-pointer flex items-center gap-2"
            >
              <Zap size={15} className={isOptimizerRunning ? 'animate-spin' : ''} />
              <span>{isOptimizerRunning ? 'در حال محاسبات تخصیص...' : 'اجرای الگوریتم تخصیص بهینه'}</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 relative">
            
            {/* Supply Column */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between bg-brand-800 text-signal-400 p-3 rounded-xl">
                <span className="font-bold text-xs">ضلع عرضه</span>
                <span className="text-[10px] bg-surface/20 px-2 py-0.5 rounded">۴ ظرفیت آماده</span>
              </div>

              {supplies.map(sup => (
                <div key={sup.id} className="p-3.5 border border-line rounded-2xl bg-surface flex flex-col gap-1.5 hover:border-brand-800 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-ink-800">{sup.title}</span>
                    <span className="text-[10px] font-bold text-brand-800 bg-brand-100 px-2 py-0.5 rounded">{sup.owner}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-ink-500">
                    <span>ارزش: {sup.value}</span>
                    <span className="text-ok font-bold">جفت‌شده با {sup.matchedDemandIds.length} تقاضا</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Demand Column */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between bg-brand-900 text-white p-3 rounded-xl">
                <span className="font-bold text-xs">ضلع تقاضا</span>
                <span className="text-[10px] bg-surface/20 px-2 py-0.5 rounded">۳ نیاز اولویت‌دار</span>
              </div>

              {demands.map(dem => (
                <div key={dem.id} className="p-3.5 border border-line rounded-2xl bg-surface flex flex-col gap-1.5 hover:border-brand-900 transition-all">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-ink-800">{dem.title}</span>
                    <span className="text-[10px] font-bold text-danger bg-danger-soft px-2 py-0.5 rounded">{dem.cellName}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-ink-500">
                    <span>سرمایه مورد نیاز: {dem.requiredCapital} میلیون دلار</span>
                    <span className="text-brand-700 font-bold">محرومیت: {dem.deprivationLevel}٪</span>
                  </div>
                </div>
              ))}
            </div>

          </div>

        </div>
      )}

      {/* ==========================================
          BOTTOM COMPARE BAR & PARETO EXPLORER
          ========================================== */}
      {compareIds.length > 0 && (
        <div id="compare-bar" className="bg-brand-800 text-white p-3 rounded-2xl shadow-xl border border-signal-400/30 flex flex-wrap items-center justify-between gap-3 animate-fade-in">
          <div className="flex items-center gap-2">
            <GitCompare size={18} className="text-signal-400" />
            <span className="text-xs font-bold">نوار مقایسه همزمان: <strong className="text-signal-400">{compareIds.length} انطباق</strong> منتخب</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsCompareModalOpen(true)}
              className="px-3 py-1.5 bg-signal-400 hover:bg-signal-500 text-brand-900 rounded-xl text-xs font-black transition-all cursor-pointer shadow-sm"
            >
              مشاهده جدول مقایسه تفصیلی
            </button>

            <button
              onClick={() => setCompareIds([])}
              className="px-2 py-1.5 bg-surface/10 hover:bg-surface/20 text-white rounded-xl text-xs font-bold cursor-pointer"
            >
              پاک‌سازی
            </button>
          </div>
        </div>
      )}

      {/* Permanent Auditor Disclaimer */}
      <div className="bg-surface border border-line p-2.5 rounded-xl text-center text-[11px] text-ink-500">
        ⚖️ <strong>قانون شفافیت:</strong> کلیه پیشنهادهای انطباق، پیشنهاد کارشناسی هوشمند هستند و مجوز اجرای نهایی منوط به تأیید کارگروه زیربنایی و دیوان محاسبات عالی کشور می‌باشد.
      </div>

      {/* ==========================================
          MODALS & DRAWERS
          ========================================== */}

      {/* 1. NLQ Search Modal */}
      {isNLQOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl p-6 max-w-lg w-full shadow-2xl border border-line flex flex-col gap-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-brand-800" />
                <h3 className="text-sm font-bold text-ink-800">پرس‌وجوی هوشمند زبان طبیعی</h3>
              </div>
              <button onClick={() => setIsNLQOpen(false)} className="text-ink-300 hover:text-ink-800 cursor-pointer"><X size={18} /></button>
            </div>

            <textarea
              rows={3}
              value={nlqQuery}
              onChange={(e) => setNlqQuery(e.target.value)}
              placeholder="مثال: کجا صنایع تبدیلی پسته کم‌آب‌بر با دسترسی به بازار و نیروی کار بومی صرفه اقتصادی دارد؟"
              className="w-full p-3 bg-surface border border-line rounded-xl text-xs text-ink-800 focus:outline-none focus:border-brand-800"
            />

            <div className="flex justify-end gap-2">
              <button onClick={() => setIsNLQOpen(false)} className="px-4 py-2 bg-paper text-xs font-bold rounded-xl cursor-pointer">انصراف</button>
              <button onClick={handleProcessNLQ} className="px-4 py-2 bg-brand-800 text-signal-400 text-xs font-bold rounded-xl cursor-pointer">تحلیل و اعمال وزن‌ها</button>
            </div>
          </div>
        </div>
      )}

      {/* 2. Elimination Explanation Modal */}
      {isEliminatedModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl p-6 max-w-xl w-full shadow-2xl border border-line flex flex-col gap-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2 text-danger font-bold text-sm">
                <AlertTriangle size={18} />
                <span>گزارش شفافیت حذف کاندیدها</span>
              </div>
              <button onClick={() => setIsEliminatedModalOpen(false)} className="text-ink-300 hover:text-ink-800 cursor-pointer"><X size={18} /></button>
            </div>

            <div className="space-y-3 max-h-[350px] overflow-y-auto">
              {scoredCandidates.filter(c => c.isEliminated).map(cand => (
                <div key={cand.id} className="p-3 bg-danger-soft border border-danger/40 rounded-xl text-xs flex flex-col gap-1">
                  <span className="font-bold text-danger-700">{cand.cellName} ({cand.planTitle})</span>
                  <p className="text-danger text-[11px]">{cand.eliminationReason}</p>
                </div>
              ))}
            </div>

            <button onClick={() => setIsEliminatedModalOpen(false)} className="self-end px-4 py-2 bg-brand-800 text-signal-400 rounded-xl text-xs font-bold cursor-pointer">متوجه شدم</button>
          </div>
        </div>
      )}

      {/* 3. Detailed Compare Matrix Modal */}
      {isCompareModalOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl p-6 max-w-4xl w-full shadow-2xl border border-line flex flex-col gap-4 animate-fade-in max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <GitCompare size={18} className="text-brand-800" />
                <h3 className="text-sm font-bold text-ink-800">ماتریس مقایسه هم‌مقیاس انطباق‌های منتخب</h3>
              </div>
              <button onClick={() => setIsCompareModalOpen(false)} className="text-ink-300 hover:text-ink-800 cursor-pointer"><X size={18} /></button>
            </div>

            <table className="w-full text-right text-xs border-collapse">
              <thead>
                <tr className="bg-brand-800 text-signal-400">
                  <th className="p-2.5">شاخص مقایسه‌ای</th>
                  {compareIds.map(id => {
                    const cand = candidates.find(c => c.id === id);
                    return <th key={id} className="p-2.5 text-center">{cand?.cellName}</th>;
                  })}
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-line">
                  <td className="p-2.5 font-bold">امتیاز انطباق نهایی</td>
                  {compareIds.map(id => {
                    const cand = scoredCandidates.find(c => c.id === id);
                    return <td key={id} className="p-2.5 text-center font-bold text-ok">{cand?.totalScore}٪</td>;
                  })}
                </tr>
                <tr className="border-b border-line">
                  <td className="p-2.5 font-bold">سرمایه مورد نیاز</td>
                  {compareIds.map(id => {
                    const cand = candidates.find(c => c.id === id);
                    return <td key={id} className="p-2.5 text-center">{cand?.capitalNeeded}M$</td>;
                  })}
                </tr>
                <tr className="border-b border-line">
                  <td className="p-2.5 font-bold">ایجاد اشتغال مستقیم</td>
                  {compareIds.map(id => {
                    const cand = candidates.find(c => c.id === id);
                    return <td key={id} className="p-2.5 text-center">{cand?.jobsCreated} نفر</td>;
                  })}
                </tr>
                <tr className="border-b border-line">
                  <td className="p-2.5 font-bold">اثر هیدرولوژیک آب</td>
                  {compareIds.map(id => {
                    const cand = candidates.find(c => c.id === id);
                    return <td key={id} className="p-2.5 text-center text-[10px]">{cand?.waterImpact}</td>;
                  })}
                </tr>
              </tbody>
            </table>

            <button onClick={() => setIsCompareModalOpen(false)} className="self-end px-4 py-2 bg-brand-800 text-signal-400 rounded-xl text-xs font-bold cursor-pointer">بستن</button>
          </div>
        </div>
      )}

      {/* 4. Version Tree Modal */}
      {isVersionTreeOpen && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-surface rounded-2xl p-6 max-w-md w-full shadow-2xl border border-line flex flex-col gap-4 animate-fade-in">
            <div className="flex items-center justify-between border-b border-line pb-3">
              <div className="flex items-center gap-2">
                <GitCompare size={18} className="text-brand-800" />
                <h3 className="text-sm font-bold text-ink-800">درخت نسخه‌های مسئله انطباق</h3>
              </div>
              <button onClick={() => setIsVersionTreeOpen(false)} className="text-ink-300 hover:text-ink-800 cursor-pointer"><X size={18} /></button>
            </div>

            <div className="space-y-2 text-xs">
              <div className="p-3 bg-brand-100 border border-brand-800 rounded-xl flex flex-col gap-1">
                <span className="font-bold text-brand-800">نسخه فعال: بختگان v2.1 (مبنای مصوب)</span>
                <span className="text-[10px] text-ink-500">توسط: دکتر امین کلانتری - هم‌اکنون</span>
              </div>
              <div className="p-3 bg-paper border border-line rounded-xl flex flex-col gap-1 opacity-75">
                <span className="font-bold text-ink-800">نسخه بختگان v2.0 (سناریوی توسعه)</span>
                <span className="text-[10px] text-ink-500">توسط: مهندس زهرا احمدی - دیروز</span>
              </div>
            </div>

            <button onClick={() => setIsVersionTreeOpen(false)} className="self-end px-4 py-2 bg-brand-800 text-signal-400 rounded-xl text-xs font-bold cursor-pointer">متوجه شدم</button>
          </div>
        </div>
      )}

    </div>
  );
}
