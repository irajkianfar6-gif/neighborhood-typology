"""
Zonal statistics روی رسترهای پایه (WorldPop، GHSL، NDVI، DEM، پهنهٔ سیل) برای مرز محله.

امنیت: مسیر فایل از بیرون پذیرفته نمی‌شود؛ فقط raster_id های ثبت‌شده که مسیرشان
از متغیر محیطی می‌آید (مثلاً WORLDPOP_COG_PATH).

خروجی: sum, mean, count (پیکسل معتبر), valid_fraction, pixel_area_m2، و در صورت درخواست
جمع/میانگین درون سلول‌های مربعی حول مراکز داده‌شده (برای وزن جمعیتی شبکهٔ مبدأ).
"""
from __future__ import annotations

import math
import os
from typing import Any

RASTER_ENV = {
    "worldpop": "WORLDPOP_COG_PATH",
    "ghsl_built": "GHSL_COG_PATH",
    "ndvi": "NDVI_COG_PATH",
    "worldcover": "WORLDCOVER_COG_PATH",
    "dem": "DEM_COG_PATH",
    "jrc_flood": "JRC_FLOOD_COG_PATH",
    "slope": "SLOPE_COG_PATH",
}

_CITY_RE = __import__("re").compile(r"^[a-z0-9_-]{1,40}$")


def open_raster_dir() -> str:
    """پوشهٔ رسترهای بریده‌شدهٔ شهری که scripts/fetch_open_data می‌سازد (<id>__<city>.tif)."""
    if os.environ.get("ARA_OPEN_RASTER_DIR"):
        return os.environ["ARA_OPEN_RASTER_DIR"]
    base = os.environ.get("ARA_SERVER_DATA_DIR") or os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "server", "data")
    return os.path.join(base, "open-rasters")


class ZonalError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


def available_rasters() -> dict[str, dict[str, Any]]:
    out = {}
    for rid, env in RASTER_ENV.items():
        p = os.environ.get(env, "")
        out[rid] = {"env": env, "configured": bool(p), "exists": bool(p) and os.path.exists(p)}
    return out


def _resolve(raster_id: str, city: str | None = None) -> str:
    env = RASTER_ENV.get(raster_id)
    if not env:
        raise ZonalError("UNKNOWN_RASTER", f"raster_id ناشناخته: {raster_id}")
    path = os.environ.get(env, "")
    if path and os.path.exists(path):
        return path
    # جایگزین امن: فقط نام ثابت <raster_id>__<city>.tif درون پوشهٔ رسترهای باز
    if city and _CITY_RE.match(city):
        candidate = os.path.join(open_raster_dir(), f"{raster_id}__{city}.tif")
        if os.path.exists(candidate):
            return candidate
    raise ZonalError("RASTER_NOT_CONFIGURED", f"{env} تنظیم نشده و رستر شهری {raster_id}__{city}.tif وجود ندارد")


def zonal_stats(raster_id: str, geometry: dict, cell_centers: list[list[float]] | None = None,
                cell_size_m: float | None = None, threshold: float | None = None,
                city: str | None = None, class_groups: dict[str, list[int]] | None = None) -> dict:
    try:
        import numpy as np
        import rasterio
        from rasterio.mask import mask as rio_mask
        from rasterio.warp import transform_geom
    except ImportError as exc:  # pragma: no cover
        raise ZonalError("DEPENDENCY_MISSING", f"rasterio/numpy نصب نیست: {exc}")

    path = _resolve(raster_id, city)
    with rasterio.open(path) as ds:
        geom = geometry
        if ds.crs and ds.crs.to_epsg() != 4326:
            geom = transform_geom("EPSG:4326", ds.crs, geometry)
        try:
            data, transform = rio_mask(ds, [geom], crop=True, filled=False, all_touched=False)
        except ValueError:
            raise ZonalError("OUT_OF_EXTENT", "مرز خارج از پوشش رستر است")
        band = data[0]
        nodata = ds.nodata
        arr = np.ma.masked_invalid(band.astype("float64"))
        if nodata is not None:
            arr = np.ma.masked_equal(arr, nodata)
        # پیکسل‌های درون مرز مستقل از nodata (rio_mask هر دو را ماسک می‌کند)
        from rasterio.features import geometry_mask
        inside = geometry_mask([geom], out_shape=band.shape, transform=transform, invert=True, all_touched=False)
        total_inside = int(inside.sum())
        valid = arr.compressed()
        res_x, res_y = abs(transform.a), abs(transform.e)
        # مساحت پیکسل (m²) — برای رستر جغرافیایی تقریب در عرض میانی
        if ds.crs and ds.crs.is_geographic:
            lat_mid = transform.f - res_y * band.shape[0] / 2
            pixel_area = (res_x * 111_320 * math.cos(math.radians(lat_mid))) * (res_y * 111_320)
        else:
            pixel_area = res_x * res_y
        out: dict[str, Any] = {
            "raster_id": raster_id,
            "file": os.path.basename(path),
            "count": int(valid.size),
            "inside_pixels": total_inside,
            "valid_fraction": round(valid.size / total_inside, 4) if total_inside else 0.0,
            "sum": float(valid.sum()) if valid.size else None,
            "mean": float(valid.mean()) if valid.size else None,
            "min": float(valid.min()) if valid.size else None,
            "max": float(valid.max()) if valid.size else None,
            "pixel_area_m2": round(pixel_area, 2),
        }
        if threshold is not None and valid.size:
            out["share_ge_threshold"] = round(float((valid >= threshold).sum()) / valid.size, 4)
        groups = {str(k): [int(c) for c in v] for k, v in (class_groups or {}).items() if isinstance(v, list)}
        if groups and valid.size:
            out["class_fractions"] = {k: round(float(np.isin(valid, v).sum()) / valid.size, 4) for k, v in groups.items()}
        if cell_centers and cell_size_m:
            filled = arr.filled(0.0)
            half_x = (cell_size_m / 2) / (111_320 * math.cos(math.radians(cell_centers[0][1]))) if ds.crs.is_geographic else cell_size_m / 2
            half_y = (cell_size_m / 2) / 111_320 if ds.crs.is_geographic else cell_size_m / 2
            inv = ~transform
            cells = []
            cell_share = [] if threshold is not None else None
            cell_classes = [] if groups else None
            for lng, lat in cell_centers:
                c0, r0 = inv * (lng - half_x, lat + half_y)
                c1, r1 = inv * (lng + half_x, lat - half_y)
                r0, r1 = max(0, int(math.floor(min(r0, r1)))), min(filled.shape[0], int(math.ceil(max(r0, r1))))
                c0, c1 = max(0, int(math.floor(min(c0, c1)))), min(filled.shape[1], int(math.ceil(max(c0, c1))))
                cells.append(float(filled[r0:r1, c0:c1].sum()) if r1 > r0 and c1 > c0 else 0.0)
                win = arr[r0:r1, c0:c1].compressed() if r1 > r0 and c1 > c0 else np.array([])
                if cell_share is not None:
                    cell_share.append(round(float((win >= threshold).sum()) / win.size, 4) if win.size else None)
                if cell_classes is not None:
                    cell_classes.append({k: round(float(np.isin(win, v).sum()) / win.size, 4) for k, v in groups.items()} if win.size else None)
            out["cells"] = cells
            if cell_share is not None:
                out["cell_share_ge_threshold"] = cell_share
            if cell_classes is not None:
                out["cell_class_fractions"] = cell_classes
        return out
