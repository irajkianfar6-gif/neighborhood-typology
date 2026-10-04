<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/f10591a0-9368-4a5b-8091-fdf5c8b51f2a

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`

## تحلیل فقط با نام محله (ARA-NB-2.0)

`POST /api/decision-support/neighborhoods/analyze` با `{"name":"یوسف آباد"}` — مرز رسمی نسخه‌دار، شواهد مستند با منبع/تاریخ/پایایی،
دروازهٔ انتشار و امتناع صریح در نبود داده. راهنمای کامل: [docs/NEIGHBORHOOD_PIPELINE_FA.md](docs/NEIGHBORHOOD_PIPELINE_FA.md).

## API and production

For local development, run the API in a second terminal:

```powershell
npm run sci:server
```

Vite proxies `/api/*` to `http://localhost:4001`. For a separate deployed API, set `VITE_API_BASE_URL` before building. Leave it empty when the UI and API share one origin.

If port `4001` is already occupied, start the backend on another port and point the development proxy at it:

```powershell
$env:SCI_PORT = '4108'
$env:ARA_API_PROXY_TARGET = 'http://localhost:4108'
```

```text
VITE_API_BASE_URL=https://api.example.ir
ARA_API_PROXY_TARGET=http://localhost:4001
SCI_PORT=4001
```

The production server serves both `dist` and the API routes:

```powershell
npm run build
npm start
```

External provider telemetry is available at `/api/external-data/health`. Provider responses include `X-Correlation-ID`, `X-Provider`, `X-Cache`, and `X-Provider-Latency-Ms` headers.

## Satellite STAC metadata

The backend exposes a metadata-only satellite connector at `/api/satellite`. It searches Copernicus Data Space first and falls back to Element 84 Earth Search without downloading raster assets.

```text
GET  /api/satellite/health
GET  /api/satellite/search?collection=sentinel-2-l2a&bbox=44,25,63,40&maxAgeHours=24&maxCloudCover=20
GET  /api/satellite/metadata
GET  /api/satellite/items/:provider/:collection/:itemId
POST /api/satellite/metadata/register
```

Search results are normalized and registered idempotently in the gitignored `server/data/satellite-items.json`. Signed credential parameters are not persisted.

### Satellite COG and spatial pipeline

The next pipeline phase is now available behind the same `/api/satellite` module:

```text
GET  /api/satellite/pipeline/health
GET  /api/satellite/pipeline/jobs
GET  /api/satellite/pipeline/jobs/:jobId
POST /api/satellite/pipeline/jobs
POST /api/satellite/pipeline/jobs/:jobId/retry
GET  /api/satellite/pipeline/jobs/:jobId/artifacts/:relativePath
GET  /api/satellite/pipeline/spatial/search?bbox=44,25,63,40&kind=index
```

Create a job using a registered `metadata_id` and an AOI bbox. The server selects Sentinel-2 bands (blue, green, red, NIR, SWIR1/2, SCL) or Sentinel-1 VV/VH, then asynchronously runs `scripts/satellite_cog_worker.py`. The worker reads only the AOI window through Rasterio, aligns resolutions/CRS, masks SCL cloud/shadow/snow classes, writes tiled Deflate COGs with overviews, computes NDVI/NDWI/MNDWI/NDBI/NDMI/NBR or VV/VH ratios, and returns checksums and validation evidence. Completed artifact bounds are indexed in a SQLite R*Tree (`server/data/satellite-spatial.sqlite`) with a JSON sidecar fallback for older Node runtimes.

Install the raster worker dependencies once:

```powershell
python -m pip install -r scripts/requirements-satellite.txt
```

The output and job stores are gitignored. A failed job remains visible with an actionable error and can be retried after the source or environment is fixed. AI/image models are intentionally not part of this phase; they should consume only validated COG artifacts in the next phase.

### Satellite validation matrix and CI

Every worker result carries the following pre-ML checks:

| Check | Pass condition | Failure/review signal |
|---|---|---|
| QA mask | pixel counts are in range and valid/clear pixels exist | empty or inconsistent counts; clear fraction below 10% is a warning |
| AOI coverage | output bounds cover at least 99% of requested AOI | partial intersection is review; no intersection fails |
| Co-registration | all bands share CRS, dimensions and affine transform | any grid drift fails |
| Temporal anomaly | robust median/MAD series has no outlier | anomaly is a review warning; fewer than five observations is not applicable |

Run the complete offline gate with `npm run ci:satellite`. It runs TypeScript contracts, synthetic Rasterio QA/AOI/grid fixtures, COG validation, and writes `artifacts/satellite-validation-report.json`; the GitHub workflow uploads that report for every satellite-related change. No provider network access is required by CI.
