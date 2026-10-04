# ============================================================
# سامانه آرا — تصویر استقرار تولیدی (UI ساخته‌شده + API + هسته پایتون)
# ساخت چندمرحله‌ای:
#   1) builder  → نصب وابستگی‌ها و ساخت UI با Vite
#   2) runtime  → Node + Python (kernel service و workerهای ماهواره) + dist + کد سرور
# اجرا: docker compose up -d --build     → http://localhost:8080
# ============================================================
# syntax=docker/dockerfile:1

# ---------- مرحله ۱: ساخت UI ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NODE_OPTIONS=--max-old-space-size=4096
COPY package.json package-lock.json ./
# بدون --omit=optional: باینری‌های esbuild/rollup وابستگی اختیاری‌اند و build بدون آن‌ها می‌شکند
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# رجیستر ۱۶۴ شاخصی با نام فارسی در ریشه پروژه قرار دارد و لودر سرور آن را
# با جست‌وجوی نام فایل پیدا می‌کند؛ اینجا بدون تایپ نام فارسی کپی می‌شود.
RUN set -eux; mkdir -p /app/registry-src; \
    for f in /app/*.csv; do case "$f" in *164*) cp "$f" /app/registry-src/ ;; esac; done; \
    ls -l /app/registry-src

# ---------- مرحله ۲: اجرا ----------
FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    SCI_PORT=4001 \
    PYTHONUNBUFFERED=1 \
    PYTHONUTF8=1 \
    KERNEL_PYTHON=python3

# Python برای سه worker ماهواره‌ای و سرویس محاسبات kernel لازم است.
# rasterio/numpy → پردازش COG و رندر تایل؛ shapely → اعتبارسنجی مرز در kernel.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 python3-pip python3-venv ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && rm -f /usr/lib/python3*/EXTERNALLY-MANAGED || true

# pyproj برای اعتبارسنجی مرز و zonal stats در CRS متریک الزامی است
COPY kernel/requirements.txt /tmp/kernel-requirements.txt
RUN python3 -m pip install --no-cache-dir -r /tmp/kernel-requirements.txt

WORKDIR /app

# وابستگی‌های زمان اجرا (tsx برای اجرای server/*.ts لازم است)
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && npm cache clean --force

# کد سرویس: server (TS) + src (ماژول‌های الگوریتمی که سرور import می‌کند)
COPY tsconfig.json ./
COPY server ./server
COPY src ./src

# هسته محاسبات، مرزهای محلی، رجیسترها و پیکربندی گونه‌بندی
COPY kernel ./kernel
COPY mahalat ./mahalat
COPY neighborhood_typology ./neighborhood_typology
COPY scripts ./scripts
COPY templates ./templates
COPY data ./data
COPY docs/decision-support ./docs/decision-support
COPY --from=builder /app/registry-src ./
COPY --from=builder /app/dist ./dist

# سرور، دارایی‌های سمت‌سرور را از public/ می‌خواند (pois.json، roads.json، places.json …).
# چون Vite محتوای public را داخل dist هم می‌کابد، برای پرهیز از ۴۰۰MB تکرار، public را
# به dist پیوند می‌دهیم تا همان فایل‌ها در هر دو مسیر در دسترس باشند.
RUN ln -s /app/dist /app/public && mkdir -p /app/server/data && chown -R node:node /app

USER node
EXPOSE 4001
VOLUME ["/app/server/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.SCI_PORT||4001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
