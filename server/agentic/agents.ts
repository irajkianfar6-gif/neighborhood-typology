/**
 * ثبت عامل‌ها و سیاست «حداقل دسترسی»: هر عامل فقط ابزارهای مأموریت خودش را می‌تواند فراخوانی کند.
 * وضعیت active = در گراف استاندارد فعال؛ planned = طراحی شده، ابزار آن در فازهای بعد افزوده می‌شود.
 */
export type AgentId = 'A0' | 'A1' | 'A2' | 'A3' | 'A4' | 'A5' | 'A6' | 'A7' | 'A8' | 'A9' | 'A10' | 'A11' | 'A12' | 'A13' | 'A14' | 'operator';

export interface AgentSpec {
  id: AgentId;
  nameFa: string;
  mission: string;
  status: 'active' | 'planned';
  autonomy: 'full' | 'full_with_gate' | 'draft_only' | 'human';
  tools: string[];
  humanApproval: string[];
  phase: number;
}

export const AGENT_POLICY_VERSION = 'AGP-v1';

export const AGENTS: AgentSpec[] = [
  { id: 'A0', nameFa: 'هماهنگ‌کننده', mission: 'تبدیل درخواست به گراف وظایف، فراخوانی عامل‌ها، تصمیم در دروازه‌ها و جمع‌بندی', status: 'active', autonomy: 'full_with_gate', tools: ['list_cities', 'resolve_neighborhood', 'get_neighborhood_profile', 'get_run_history', 'get_reproducibility_key', 'list_data_sources'], humanApproval: [], phase: 2 },
  { id: 'A1', nameFa: 'شناسایی و مرز', mission: 'نام → شناسهٔ یکتای محله → مرز رسمی نسخه‌دار و بافت جمعیتی', status: 'active', autonomy: 'full_with_gate', tools: ['list_cities', 'resolve_neighborhood', 'get_neighborhood_profile', 'build_context'], humanApproval: ['انتخاب محله وقتی اطمینان تطبیق کمتر از ۰٫۹ یا نام مبهم است'], phase: 2 },
  { id: 'A2', nameFa: 'کاشف منابع', mission: 'یافتن منبع برای شاخص‌های بدون داده (فاز ۳: جست‌وجوی وب)', status: 'planned', autonomy: 'draft_only', tools: ['list_data_sources', 'get_collection_plan'], humanApproval: ['افزودن منبع دائمی به فهرست منابع'], phase: 3 },
  { id: 'A3', nameFa: 'گردآوری داده', mission: 'دریافت شواهد از همهٔ کانال‌ها و ساخت بستهٔ شاهد استاندارد', status: 'active', autonomy: 'full', tools: ['build_context', 'collect_evidence', 'list_data_sources'], humanApproval: [], phase: 2 },
  { id: 'A4', nameFa: 'استخراج از اسناد', mission: 'استخراج جدول و عدد از PDF/اکسل/صفحهٔ رسمی با ارجاع سلولی (فاز ۳)', status: 'planned', autonomy: 'full_with_gate', tools: ['list_data_sources'], humanApproval: [], phase: 3 },
  { id: 'A5', nameFa: 'تطبیق فضایی و هم‌سازی', mission: 'تطبیق فهرست‌ها و مرزهای ناهمسان، تبدیل واحد و سال (فاز ۳)', status: 'planned', autonomy: 'full_with_gate', tools: ['get_neighborhood_profile', 'assess_local_layers'], humanApproval: [], phase: 3 },
  { id: 'A6', nameFa: 'کنترل کیفیت و منشأ', mission: 'اعتبار، تازگی، تضاد، استقلال شواهد و دروازهٔ پوشش', status: 'active', autonomy: 'full', tools: ['collect_evidence', 'assess_evidence', 'evaluate_publication_gate'], humanApproval: [], phase: 2 },
  { id: 'A7', nameFa: 'سنجه', mission: 'اجرای موتور قطعی سنجه روی شواهد پذیرفته‌شده', status: 'active', autonomy: 'full', tools: ['run_analysis', 'get_reproducibility_key'], humanApproval: [], phase: 2 },
  { id: 'A8', nameFa: 'پیمایش و میدان', mission: 'برنامهٔ گردآوری، حجم نمونه، ممیزی میدانی و کنترل کیفیت پاسخ‌ها', status: 'active', autonomy: 'draft_only', tools: ['get_collection_plan', 'summarize_field_audits'], humanApproval: ['اجرای میدانی پیمایش و ممیزی'], phase: 5 },
  { id: 'A9', nameFa: 'تشخیص', mission: 'گلوگاه، قواعد لایه‌ها و آزمون فرضیه‌های رقیب', status: 'active', autonomy: 'full', tools: ['locate_bottleneck', 'test_hypotheses', 'assess_local_layers'], humanApproval: [], phase: 2 },
  { id: 'A10', nameFa: 'تجویز', mission: 'نگاشت یافته‌ها به کتابخانهٔ مداخلات با پیش‌نیاز و شاخص پایش', status: 'active', autonomy: 'draft_only', tools: ['map_interventions', 'get_intervention_library'], humanApproval: ['تصویب تجویز اجرایی'], phase: 2 },
  { id: 'A11', nameFa: 'شبیه‌سازی سناریو', mission: 'آزمون «اگر…» و حساسیت تشخیص به دادهٔ کم‌اعتبار (فاز ۴)', status: 'planned', autonomy: 'full', tools: ['get_run_history'], humanApproval: [], phase: 4 },
  { id: 'A12', nameFa: 'نقاد / تیم قرمز', mission: 'بازبینی قطعی منشأ، سازگاری متن و عدد، قواعد پروژه و استقلال شواهد', status: 'active', autonomy: 'full', tools: ['verify_analysis', 'evaluate_publication_gate', 'get_reproducibility_key'], humanApproval: [], phase: 2 },
  { id: 'A13', nameFa: 'گزارش و ارتباط', mission: 'گزارش دولایه (تحلیلی/رسمی) با ارجاع هر عدد', status: 'active', autonomy: 'full_with_gate', tools: ['render_report'], humanApproval: ['انتشار رسمی گزارش'], phase: 2 },
  { id: 'A14', nameFa: 'پایش و یادگیری', mission: 'پیگیری اجراها، ناهنجاری و پیشنهاد واسنجی', status: 'active', autonomy: 'draft_only', tools: ['get_run_history'], humanApproval: ['تغییر قواعد، وزن‌ها یا کتابخانه'], phase: 5 },
  { id: 'operator', nameFa: 'کارشناس (انسان) / کلاینت MCP', mission: 'دسترسی کامل برای آزمون و راهبری', status: 'active', autonomy: 'human', tools: ['*'], humanApproval: [], phase: 1 },
];

export function getAgent(id: string): AgentSpec | undefined { return AGENTS.find((a) => a.id === id); }

export function canUse(agentId: string, tool: string): boolean {
  const a = getAgent(agentId);
  return Boolean(a && (a.tools.includes('*') || a.tools.includes(tool)));
}
