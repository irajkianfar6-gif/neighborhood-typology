"""
آماده‌سازی دادهٔ باز جهانی برای یک شهر (یک‌بار، نیازمند اینترنت) — شاخص‌های N4، N5 و R5.

    python kernel/gis/open_data.py --city tehran --bbox 51.09,35.55,51.61,35.84 --out server/data

خروجی‌ها (همه کوچک و بریده‌شده به محدودهٔ شهر):
  open-rasters/jrc_flood__<city>.tif   عمق سیل دورهٔ بازگشت ۱۰۰ ساله (JRC CEMS-GloFAS v2.1، ~۹۰ متر)
  open-rasters/worldcover__<city>.tif  پوشش زمین ESA WorldCover 2021 v200 (۱۰ متر)
  open-rasters/slope__<city>.tif       شیب (٪) از Copernicus DEM GLO-30
  open-vector/<city>/faults.json       گسل‌های فعال GEM Global Active Faults (CC BY-SA 4.0)
  open-vector/<city>/ookla_fixed.json / ookla_mobile.json  کاشی‌های Speedtest by Ookla (CC BY-NC-SA 4.0)

هیچ عددی ساخته نمی‌شود: اگر منبعی در دسترس نباشد، فایلش ساخته نمی‌شود و شاخص در برنامه «missing» می‌ماند.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import sys
import urllib.request

JRC_URL = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/CEMS-GLOFAS/flood_hazard/RP100/{name}_RP100_depth.tif"
WORLDCOVER_URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{tile}_Map.tif"
DEM_URL = "https://copernicus-dem-30m.s3.amazonaws.com/Copernicus_DSM_COG_10_{tile}_DEM/Copernicus_DSM_COG_10_{tile}_DEM.tif"
GEM_URL = "https://raw.githubusercontent.com/GEMScienceTools/gem-global-active-faults/master/geojson/gem_active_faults_harmonized.geojson"
JRC_EXTENTS_URL = "https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/CEMS-GLOFAS/flood_hazard/tile_extents.geojson"


def log(msg: str) -> None:
    print(msg, flush=True)


def _rio_env():
    import rasterio
    return rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_HTTP_MAX_RETRY="3", GDAL_HTTP_RETRY_DELAY="2",
                        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif")


def clip_remote(urls: list[str], bbox, out_path: str, resampling_note: str = "") -> dict:
    """پنجرهٔ bbox را از یک یا چند COG راه‌دور می‌خواند (بدون دانلود کل فایل) و GeoTIFF فشرده می‌نویسد."""
    import rasterio
    from rasterio.merge import merge
    with _rio_env():
        srcs = [rasterio.open("/vsicurl/" + u) for u in urls]
        try:
            arr, transform = merge(srcs, bounds=tuple(bbox))
            profile = srcs[0].profile.copy()
        finally:
            for s in srcs:
                s.close()
    profile.update(driver="GTiff", height=arr.shape[1], width=arr.shape[2], transform=transform, compress="deflate",
                   tiled=True, blockxsize=256, blockysize=256, count=1)
    profile.pop("photometric", None)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(arr[0], 1)
    return {"file": out_path, "shape": list(arr.shape[1:]), "sources": urls}


def tiles_1deg(bbox) -> list[str]:
    w, s, e, n = bbox
    out = []
    for lat in range(math.floor(s), math.floor(n) + 1):
        for lon in range(math.floor(w), math.floor(e) + 1):
            out.append(f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}_00_{'E' if lon >= 0 else 'W'}{abs(lon):03d}_00")
    return out


def tiles_3deg(bbox) -> list[str]:
    w, s, e, n = bbox
    out = []
    for lat in range(math.floor(s / 3) * 3, math.floor(n / 3) * 3 + 1, 3):
        for lon in range(math.floor(w / 3) * 3, math.floor(e / 3) * 3 + 1, 3):
            out.append(f"{'N' if lat >= 0 else 'S'}{abs(lat):02d}{'E' if lon >= 0 else 'W'}{abs(lon):03d}")
    return out


def jrc_tile_names(bbox) -> list[str]:
    with urllib.request.urlopen(JRC_EXTENTS_URL, timeout=60) as r:
        fc = json.load(r)
    w, s, e, n = bbox
    names = []
    for f in fc["features"]:
        xs = [p[0] for p in f["geometry"]["coordinates"][0]]
        ys = [p[1] for p in f["geometry"]["coordinates"][0]]
        if not (max(xs) < w or min(xs) > e or max(ys) < s or min(ys) > n):
            names.append(f"ID{f['properties']['id']}_{f['properties']['name']}")
    return names


def build_slope(bbox, out_path: str) -> dict:
    import numpy as np
    import rasterio
    tmp = out_path + ".dem.tif"
    info = clip_remote([DEM_URL.format(tile=t) for t in tiles_1deg(bbox)], bbox, tmp)
    with rasterio.open(tmp) as ds:
        z = ds.read(1).astype("float64")
        t = ds.transform
        lat_mid = t.f + t.e * z.shape[0] / 2
        dx = abs(t.a) * 111_320 * math.cos(math.radians(lat_mid))
        dy = abs(t.e) * 111_320
        gy, gx = np.gradient(z, dy, dx)
        slope = (np.hypot(gx, gy) * 100).astype("float32")
        profile = ds.profile.copy()
    profile.update(dtype="float32", nodata=-1, compress="deflate")
    with rasterio.open(out_path, "w", **profile) as dst:
        dst.write(slope, 1)
    os.remove(tmp)
    return {"file": out_path, "shape": info["shape"], "sources": info["sources"]}


def fetch_faults(bbox, out_path: str, pad_deg: float = 0.3) -> dict:
    with urllib.request.urlopen(GEM_URL, timeout=120) as r:
        fc = json.load(r)
    w, s, e, n = bbox[0] - pad_deg, bbox[1] - pad_deg, bbox[2] + pad_deg, bbox[3] + pad_deg
    keep = []
    for f in fc.get("features", []):
        g = f.get("geometry") or {}
        lines = g.get("coordinates", [])
        if g.get("type") == "LineString":
            lines = [lines]
        elif g.get("type") != "MultiLineString":
            continue
        pts = [p for ln in lines for p in ln]
        if not pts:
            continue
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        if max(xs) < w or min(xs) > e or max(ys) < s or min(ys) > n:
            continue
        props = f.get("properties", {})
        keep.append({"name": props.get("name"), "slip_type": props.get("slip_type"), "lines": [[[round(x, 6), round(y, 6)] for x, y, *_ in ln] for ln in lines]})
    out = {"source": "GEM Global Active Faults Database (CC BY-SA 4.0)", "url": GEM_URL, "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "bbox": bbox, "faults": keep}
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False)
    return {"file": out_path, "faults": len(keep)}


def _quadkey(lat: float, lng: float, z: int) -> str:
    x = (lng + 180) / 360
    s = math.sin(math.radians(lat))
    y = 0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)
    tx, ty = int(x * 2 ** z), int(y * 2 ** z)
    k = ""
    for i in range(z, 0, -1):
        m = 1 << (i - 1)
        k += str((1 if tx & m else 0) + (2 if ty & m else 0))
    return k


def _bbox_quadkey_prefixes(bbox, z: int = 10) -> list[str]:
    w, s, e, n = bbox
    out = set()
    steps = 24
    for i in range(steps + 1):
        for j in range(steps + 1):
            out.add(_quadkey(s + (n - s) * i / steps, w + (e - w) * j / steps, z))
    return sorted(out)


def fetch_ookla(bbox, out_dir: str, max_back_quarters: int = 8) -> dict:
    import pyarrow.compute as pc
    import pyarrow.parquet as pq
    from pyarrow import fs
    s3 = fs.S3FileSystem(anonymous=True, region="us-west-2")
    prefixes = _bbox_quadkey_prefixes(bbox)
    today = dt.date.today()
    result = {}
    for kind in ("fixed", "mobile"):
        y, q = today.year, (today.month - 1) // 3 + 1
        done = False
        for _ in range(max_back_quarters + 1):
            key = f"ookla-open-data/parquet/performance/type={kind}/year={y}/quarter={q}/{y}-{(q - 1) * 3 + 1:02d}-01_performance_{kind}_tiles.parquet"
            try:
                f = pq.ParquetFile(s3.open_input_file(key))
            except Exception:
                f = None
            if f is not None:
                md = f.metadata
                qi = md.schema.names.index("quadkey")
                groups = [i for i in range(md.num_row_groups)
                          if any(md.row_group(i).column(qi).statistics.min <= p + "4" and md.row_group(i).column(qi).statistics.max >= p for p in prefixes)]
                rows = []
                if groups:
                    tb = f.read_row_groups(groups, columns=["quadkey", "avg_d_kbps", "avg_u_kbps", "avg_lat_ms", "tests", "devices"])
                    mask = None
                    for p in prefixes:
                        m = pc.starts_with(tb["quadkey"], p)
                        mask = m if mask is None else pc.or_(mask, m)
                    tb = tb.filter(mask)
                    rows = tb.to_pylist()
                if rows:
                    out = {"source": "Speedtest by Ookla Global Fixed and Mobile Network Performance Maps (CC BY-NC-SA 4.0)",
                           "type": kind, "quarter": f"{y}-Q{q}", "periodStart": f"{y}-{(q - 1) * 3 + 1:02d}-01",
                           "fetchedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "zoom": 16,
                           "tiles": [{"q": r["quadkey"], "d": r["avg_d_kbps"], "u": r["avg_u_kbps"], "lat": r["avg_lat_ms"], "tests": r["tests"], "devices": r["devices"]} for r in rows]}
                    os.makedirs(out_dir, exist_ok=True)
                    path = os.path.join(out_dir, f"ookla_{kind}.json")
                    with open(path, "w", encoding="utf-8") as fh:
                        json.dump(out, fh)
                    result[kind] = {"file": path, "quarter": out["quarter"], "tiles": len(rows)}
                    done = True
                    break
                log(f"  ookla {kind} {y}-Q{q}: کاشی‌ای در محدودهٔ شهر نیست؛ فصل قبل بررسی می‌شود")
            q -= 1
            if q == 0:
                y, q = y - 1, 4
        if not done:
            result[kind] = {"error": "در ۸ فصل اخیر داده‌ای برای این محدوده یافت نشد"}
    return result


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--city", required=True)
    ap.add_argument("--bbox", required=True, help="west,south,east,north")
    ap.add_argument("--out", required=True, help="server data dir")
    ap.add_argument("--only", default="faults,flood,worldcover,slope,ookla")
    a = ap.parse_args(argv)
    bbox = [float(x) for x in a.bbox.split(",")]
    only = set(a.only.split(","))
    rdir = os.path.join(a.out, "open-rasters")
    vdir = os.path.join(a.out, "open-vector", a.city)
    steps = {
        "faults": lambda: fetch_faults(bbox, os.path.join(vdir, "faults.json")),
        "flood": lambda: clip_remote([JRC_URL.format(name=n) for n in jrc_tile_names(bbox)], bbox, os.path.join(rdir, f"jrc_flood__{a.city}.tif")),
        "worldcover": lambda: clip_remote([WORLDCOVER_URL.format(tile=t) for t in tiles_3deg(bbox)], bbox, os.path.join(rdir, f"worldcover__{a.city}.tif")),
        "slope": lambda: build_slope(bbox, os.path.join(rdir, f"slope__{a.city}.tif")),
        "ookla": lambda: fetch_ookla(bbox, vdir),
    }
    failures = 0
    for name, fn in steps.items():
        if name not in only:
            continue
        log(f"[{name}] ...")
        try:
            log(f"[{name}] OK {json.dumps(fn(), ensure_ascii=False)}")
        except Exception as exc:  # هر منبع مستقل است
            failures += 1
            log(f"[{name}] FAILED {type(exc).__name__}: {exc}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
