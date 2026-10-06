import tailwindcss from '@tailwindcss/vite';
import cesium from 'vite-plugin-cesium';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  // کلید فقط در سمت سرور (پراکسی توسعه) مصرف می‌شود و هرگز وارد باندل فرانت‌اند نمی‌شود.
  // نام متغیرها با پیشوند ARA_ تا با متغیرهای سراسری ANTHROPIC_* (مثل ابزارهای Claude Code) تداخل نکنند.
  const env = loadEnv(mode, process.cwd(), '');
  const anthropicKey = env.ARA_ANTHROPIC_API_KEY || '';
  const anthropicTarget = env.ARA_ANTHROPIC_BASE_URL || 'https://api.justwoker.icu';
  const apiProxyTarget = env.ARA_API_PROXY_TARGET || 'http://localhost:4001';

  return {
    plugins: [react(), tailwindcss(), cesium()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    optimizeDeps: {
      include: [
        'react-iran-maps',
        '@deck.gl/core',
        '@deck.gl/layers',
        '@deck.gl/react',
        '@deck.gl/aggregation-layers',
        '@deck.gl/geo-layers',
        'prop-types',
        'react-is',
      ],
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits;
      // otherwise ignore noisy dirs (desktop DB/logs and build output) to avoid reload storms.
      watch: process.env.DISABLE_HMR === 'true' ? null : { ignored: ['**/.freebuff/**', '**/dist/**'] },
      proxy: {
        // Backend سینک مرکز آمار (داده‌های سنگین: LFS / سرشماری خرد)
        '/api/sci': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        // موتور قطعی و گردش‌کار گونه‌شناسی محلات؛ همان backend ماژولار اجرا می‌شود.
        '/api/typology': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        // مسیر تصمیم‌یار: اجرای الگوریتم در سمت سرور
        '/api/decision-support': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        // هستهٔ محاسبات kernel (سرویس Python پشت Express)
        '/api/kernel': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        // پراکسی داده‌های خارجی (رفع CORS)
        '/api/external-data': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        // دروازهٔ عمومی منابع (P0): منیفست + کانکتور + کش سرورمحور
        '/api/sources': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        // کشف و ثبت متادیتای تصاویر ماهواره‌ای از کاتالوگ‌های STAC.
        '/api/satellite': {
          target: apiProxyTarget,
          changeOrigin: true,
        },
        // مسیر یکسان-مبدأ به سرویس مدل: حل CORS + نگه‌داشتن کلید در سمت سرور
        '/api/anthropic': {
          target: anthropicTarget,
          changeOrigin: true,
          ...(anthropicKey
            ? {
                headers: {
                  'x-api-key': anthropicKey,
                  'anthropic-version': '2023-06-01',
                },
              }
            : {}),
          rewrite: (p) => p.replace(/^\/api\/anthropic/, '/v1'),
        },
      },
    },
  };
});
