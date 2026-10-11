# فریمورک ایجنتیک «تصمیم‌یار جامع محله» — فاز ۰ و ۱ (پیاده‌شده)

هوش مصنوعی «هماهنگ‌کننده و پژوهشگر» است، نه «محاسبه‌گر». همهٔ عددها از موتورهای قطعی موجود می‌آیند
(ARA-NB-2.0، evidence، LR-v1، kernel). این لایه قابلیت‌های پلتفرم را به **ابزارهای استاندارد** با قرارداد JSON،
**سیاست حداقل دسترسی عامل‌ها**، **ثبت مسیر اجرا**، **گراف وظایف استاندارد** و **سرور MCP** تبدیل می‌کند.

## اجزا (`server/agentic/`)

| فایل | نقش | نسخه |
| --- | --- | --- |
| `schema.ts` | اعتبارسنج JSON Schema بدون وابستگی + سریال‌سازی پایدار برای هش | — |
| `evidencePacket.ts` | قرارداد بستهٔ شاهد، هش sha256 ضددست‌کاری، گروه‌های وابستگی (مثلاً هم‌متغیر دیوار) | `ara.evidence-packet.v1` |
| `agents.ts` | ۱۴ عامل + operator، مأموریت، سطح خودکاری، ابزارهای مجاز، نقاط تأیید انسانی | `AGP-v1` |
| `tools.ts` | ۲۰ ابزار استاندارد با طرح‌وارهٔ ورودی/خروجی و نشانه‌های رفتاری | `TOOLS-v1` |
| `registry.ts` | اجراکننده: مجوز → اعتبار ورودی → سقف زمان → اجرا → اعتبار خروجی → ثبت | — |
| `state.ts` | حافظهٔ کاری کوتاه‌مدت (بافت، شواهد، تحلیل) با TTL؛ شناسهٔ تحلیل = اثرانگشت کارت | — |
| `critic.ts` | عامل نقاد قطعی با ۱۱ بررسی (C1…C11) | `CR-v1` |
| `report.ts` | گزارش دولایهٔ تحلیلی/رسمی با ارجاع هر عدد | — |
| `pipeline.ts` | گراف استاندارد از نام محله تا گزارش با دروازه‌های G1…G6 و صف تأیید | `GRAPH-v1` |
| `mcp.ts` | سرور MCP روی HTTP (JSON-RPC 2.0) | پروتکل 2025-06-18 |
| `trace.ts` | ثبت هر فراخوانی (عامل، هش ورودی/خروجی، زمان، خطا) در `server-data/agentic/trace.jsonl` | — |
| `router.ts` | API زیر `/api/agentic` | — |

## ابزارها

`list_cities`، `resolve_neighborhood`، `get_neighborhood_profile`، `build_context`، `list_data_sources`، `collect_evidence`،
`assess_evidence`، `evaluate_publication_gate`، `run_analysis`، `locate_bottleneck`، `test_hypotheses`، `assess_local_layers`،
`map_interventions`، `get_intervention_library`، `get_collection_plan`، `summarize_field_audits`، `get_run_history`،
`get_reproducibility_key`، `verify_analysis`، `render_report`.

## API

| مسیر | کار |
| --- | --- |
| `GET /api/agentic/info` | نسخه‌ها، نقطهٔ MCP، آمار فراخوانی |
| `GET /api/agentic/tools` · `/agents` · `/evidence-schema` · `/trace` | کاتالوگ، سیاست، قرارداد، مسیر اجرا |
| `POST /api/agentic/tools/:name/call` `{agentId, input}` | فراخوانی یک ابزار (403 اگر عامل مجاز نباشد) |
| `POST /api/agentic/runs` `{name, city?, neighborhoodId?, offline?}` | اجرای کامل گراف استاندارد |
| `GET /api/agentic/runs` · `/runs/:id` | فهرست و جزئیات اجراها |
| `POST /api/agentic/runs/:id/approvals/:approvalId` `{decision}` | تأیید/رد انسانی (تجویز، انتشار رسمی) |
| `POST /api/agentic/mcp` | سرور MCP (`initialize`، `tools/list`، `tools/call`، `ping`) — سرآیند `x-ara-agent` |

نمونهٔ اتصال کلاینت MCP (HTTP): نشانی `http://<host>:4001/api/agentic/mcp`. بدون سرآیند، نقش `operator` (همهٔ ابزارها)؛
با `x-ara-agent: A9` فقط ابزارهای عامل تشخیص فهرست و اجرا می‌شوند.

## دروازه‌ها

G1 هویت (اطمینان/ابهام نام) · G2 پوشش شواهد و سطح کارت · G3 کیفیت، تضاد و استقلال شواهد · G4 سازگاری با قواعد (نقاد) ·
G5 انتشار رسمی (کارت قابل انتشار + نقاد + تأیید انسانی) · G6 تصویب تجویز (همیشه انسانی).

## کلید بازتولید

به کلید کارت `interventionLibrary` افزوده شد. `get_reproducibility_key` نسخهٔ ابزارها، سیاست عامل‌ها، قرارداد شاهد و نقاد را هم برمی‌گرداند.

## مانده برای فازهای بعد

عامل‌های A2 (جست‌وجوی وب)، A4 (استخراج اسناد)، A5 (تطبیق فضایی خودکار)، A11 (شبیه‌سازی) و لایهٔ LLM هماهنگ‌کننده
روی همین ابزارها؛ صف پایدار برای اجراهای طولانی؛ ذخیرهٔ PostgreSQL برای مسیر اجرا (ذخیرهٔ اجرای کارت از قبل حالت postgres دارد).
