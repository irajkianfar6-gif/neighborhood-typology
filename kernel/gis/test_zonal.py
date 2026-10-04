"""آزمون قرارداد آمار ناحیه‌ای روی یک رستر مصنوعی کوچک (بدون نیاز به WorldPop واقعی)."""
import os, sys, tempfile
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from gis.zonal import ZonalError, zonal_stats

passed = failed = 0
def check(name, cond):
    global passed, failed
    if cond: passed += 1; print(f"  ok   {name}")
    else: failed += 1; print(f"  FAIL {name}")

try:
    import numpy as np, rasterio
    from rasterio.transform import from_origin
except ImportError:
    print("SKIP: rasterio/numpy not installed"); sys.exit(0)

tmp = tempfile.mkdtemp()
path = os.path.join(tmp, "pop.tif")
data = np.full((10, 10), 5.0, dtype="float32"); data[0, 0] = -1  # یک سلول nodata
with rasterio.open(path, "w", driver="GTiff", height=10, width=10, count=1, dtype="float32", crs="EPSG:4326",
                   transform=from_origin(51.0, 35.01, 0.001, 0.001), nodata=-1) as dst:
    dst.write(data, 1)
os.environ["WORLDPOP_COG_PATH"] = path
poly = {"type": "Polygon", "coordinates": [[[51.0, 35.0], [51.01, 35.0], [51.01, 35.01], [51.0, 35.01], [51.0, 35.0]]]}
r = zonal_stats("worldpop", poly)
check("sum excludes nodata (99 cells × 5)", abs(r["sum"] - 495) < 1e-6)
check("valid_fraction < 1 when nodata present", 0.95 < r["valid_fraction"] < 1.0)
check("mean is 5", abs(r["mean"] - 5) < 1e-6)
try:
    zonal_stats("unknown", poly); check("unknown raster rejected", False)
except ZonalError as e:
    check("unknown raster rejected", e.args and "UNKNOWN_RASTER" in str(e.args[0]) or getattr(e, "code", "") == "UNKNOWN_RASTER")
del os.environ["WORLDPOP_COG_PATH"]
try:
    zonal_stats("worldpop", poly); check("missing raster config rejected", False)
except ZonalError:
    check("missing raster config rejected", True)
print(f"ZONAL CONTRACT TESTS: {passed}/{passed + failed} passed")
sys.exit(1 if failed else 0)
