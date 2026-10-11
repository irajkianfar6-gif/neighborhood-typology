/**
 * اعتبارسنج سبک JSON Schema (زیرمجموعهٔ draft 2020-12) برای قرارداد ابزارها و بستهٔ شاهد.
 * پشتیبانی: type (تکی/چندگانه)، properties، required، additionalProperties=false، enum، const،
 * items، minItems/maxItems، minimum/maximum، minLength/maxLength، pattern، oneOf (ساده).
 * عمداً بدون وابستگی خارجی است تا قرارداد در سرور، آزمون و سرور MCP یکسان اجرا شود.
 */
export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
export interface JsonSchema {
  type?: JsonType | JsonType[];
  description?: string;
  title?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  enum?: Array<string | number | boolean | null>;
  const?: string | number | boolean | null;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  oneOf?: JsonSchema[];
  default?: unknown;
}

function typeOf(v: unknown): JsonType {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v as JsonType;
}

function typeMatches(actual: JsonType, expected: JsonType): boolean {
  return actual === expected || (expected === 'number' && actual === 'integer');
}

/** خطاهای اعتبارسنجی را با مسیر JSON Pointer برمی‌گرداند؛ آرایهٔ خالی یعنی معتبر */
export function validate(schema: JsonSchema, value: unknown, path = ''): string[] {
  const errors: string[] = [];
  const at = path || '/';
  if (schema.oneOf) {
    const passing = schema.oneOf.filter((s) => validate(s, value, path).length === 0).length;
    if (passing !== 1) errors.push(`${at}: باید دقیقاً با یکی از ${schema.oneOf.length} حالت منطبق باشد`);
    return errors;
  }
  if (schema.type) {
    const expected = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actual = typeOf(value);
    if (!expected.some((t) => typeMatches(actual, t))) { errors.push(`${at}: نوع ${actual} مجاز نیست (انتظار ${expected.join('|')})`); return errors; }
  }
  if (schema.const !== undefined && value !== schema.const) errors.push(`${at}: باید ${JSON.stringify(schema.const)} باشد`);
  if (schema.enum && !schema.enum.includes(value as never)) errors.push(`${at}: مقدار ${JSON.stringify(value)} در فهرست مجاز نیست`);
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${at}: کمتر از ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${at}: بیشتر از ${schema.maximum}`);
    if (!Number.isFinite(value)) errors.push(`${at}: عدد نامتناهی/NaN مجاز نیست`);
  }
  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${at}: کوتاه‌تر از ${schema.minLength}`);
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${at}: بلندتر از ${schema.maxLength}`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: با الگو ${schema.pattern} منطبق نیست`);
  }
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${at}: کمتر از ${schema.minItems} عضو`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${at}: بیشتر از ${schema.maxItems} عضو`);
    if (schema.items) value.forEach((v, i) => errors.push(...validate(schema.items!, v, `${path}/${i}`)));
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const r of schema.required ?? []) if (obj[r] === undefined) errors.push(`${path}/${r}: الزامی است`);
    for (const [k, v] of Object.entries(obj)) {
      const ps = schema.properties?.[k];
      if (ps) { if (v !== undefined) errors.push(...validate(ps, v, `${path}/${k}`)); }
      else if (schema.additionalProperties === false) errors.push(`${path}/${k}: ویژگی ناشناخته`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') errors.push(...validate(schema.additionalProperties, v, `${path}/${k}`));
    }
  }
  return errors;
}

/** اعمال مقادیر پیش‌فرض سطح اول (برای ورودی ابزارها) */
export function withDefaults<T extends Record<string, unknown>>(schema: JsonSchema, input: T): T {
  const out: Record<string, unknown> = { ...input };
  for (const [k, s] of Object.entries(schema.properties ?? {})) if (out[k] === undefined && s.default !== undefined) out[k] = s.default;
  return out as T;
}

/** سریال‌سازی پایدار (کلیدهای مرتب) برای هش قطعی */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).filter((k) => obj[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`;
}
