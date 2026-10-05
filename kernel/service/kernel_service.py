"""
Kernel Core Service — Phase 0 (فاز صفر: تصمیم معماری)
======================================================
 مرز سرویس کوتاه‌مدت: HTTP داخلی بدون وابستگی خارجی (stdlib only).
 kernel = مرجع رسمی محاسبات؛ این سرویس فقط همان موتورهای kernel را فرامی‌خواند —
 هیچ محاسبه‌ای اینجا بازنویسی نمی‌شود و هیچ عددی بدون گذر از Gate منتشر نمی‌شود.

 Contract (all under /v1):
   GET  /v1/health                                  → service + version + gate summary
   GET  /v1/registries                              → registry catalog + versions
   GET  /v1/registries/<name>                        → one registry (core_40, sources_23, ...)
   POST /v1/calculation-runs                        → full CalcRun + confidence + bottleneck + publish gate
   GET  /v1/calculation-runs/<run_id>                → stored run
   GET  /v1/calculation-runs/<run_id>/drilldown/<vid> → 10-level provenance chain
   POST /v1/ingestion/validate                      → IngestionService pipeline + gate decision
   POST /v1/ingestion/approve                       → human approval workflow (APPROVED/REJECTED)
   GET  /v1/gis/boundaries/<neighborhood_id>        → real pilot boundary metadata (append-only store)
   GET  /v1/pilot/mvp2                              → real MVP-2 pilot artifacts + gate report

 اجرا:  python kernel/service/kernel_service.py   (پورت پیش‌فرض 4105)
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, unquote

KROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # .../kernel
if KROOT not in sys.path:
    sys.path.insert(0, KROOT)

from engine.calc_run import CalcRun, sha  # noqa: E402
from engine.confidence import ConfidenceEngine  # noqa: E402
from engine.bottleneck import detect_bottleneck  # noqa: E402
from engine.calc_engine import METHODOLOGY_VERSION  # noqa: E402
from ingestion.ingest import IngestionService, IngestionRecord  # noqa: E402
from ingestion.provenance_ext import ProvenanceStore  # noqa: E402
from engine.status import Measurement  # noqa: E402

REG = os.path.join(KROOT, "registries")
PILOT = os.path.join(KROOT, "pilot")
PILOT_OUT = os.path.join(PILOT, "out")
PILOT_MVP2 = os.path.join(PILOT_OUT, "mvp2")
PROV_DIR = os.path.join(PILOT_OUT, "provenance", "provenance")
# writes from the service go to a sandbox dir — pilot artifacts stay untouched
SERVICE_OUT = os.path.join(PILOT_OUT, "service")
CALC_VERSION_REGISTRY = os.path.join(REG, "calc_version_registry.json")

DEFAULT_PORT = int(os.environ.get("KERNEL_SERVICE_PORT", "4105"))
SERVICE_VERSION = "kernel-service-v0.1"

REGISTRY_FILES = {
    "registry_419": "registry_419.json",
    "core_40": "core_40.json",
    "online_83": "online_83.json",
    "procedures_25": "procedures_25.json",
    "questionnaire_15": "questionnaire_15.json",
    "sources_23": "sources_23.json",
    "weights": "weight_registry_v1.json",
    "thresholds": "threshold_registry_v1.json",
    "calc_versions": "calc_version_registry.json",
}

# large registries are truncated per-request so the API stays responsive
TRUNCATE_RECORDS = {"registry_419": 80, "online_83": 83, "core_40": 40,
                    "procedures_25": 25, "questionnaire_15": 15, "sources_23": 23}

UNIT_BY_OP = {"count_within_boundary": "count",
              "distance(euclidean_proxy_for_network)": "meter",
              "nearest_epicenter_distance": "km",
              "boundary_area(metric_crs)": "km2"}

_LOCK = threading.Lock()
_RUNS: dict[str, dict] = {}
_INGEST_RECORDS: dict[str, dict] = {}

# یک فروشگاه منشأ پایدار برای طول عمر سرویس — تا شناسه‌های VAL هرگز تکراری نشوند
_STORE: ProvenanceStore | None = None


def _store() -> ProvenanceStore:
    global _STORE
    if _STORE is None:
        _STORE = ProvenanceStore(out_dir=os.path.join(SERVICE_OUT, "provenance"))
    return _STORE


# ----------------------------------------------------------------- helpers
def _load_json(path: str):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _load_json_if(path: str):
    try:
        return _load_json(path)
    except Exception:
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _error(code: str, message: str, status: int = 400, **extra):
    return status, {"error": {"code": code, "message": message, **extra}}


def _registry_meta() -> dict:
    w = _load_json_if(os.path.join(REG, "weight_registry_v1.json")) or {}
    t = _load_json_if(os.path.join(REG, "threshold_registry_v1.json")) or {}
    cv = _load_json_if(CALC_VERSION_REGISTRY) or {"versions": []}
    return {
        "indicator_version": "registry-419-v1",
        "methodology_version": METHODOLOGY_VERSION,
        "weight_set": {"version": w.get("version"), "scheme": w.get("scheme"),
                       "calibrated": bool(w.get("calibrated")), "status": w.get("status")},
        "threshold_set": {"version": t.get("version"),
                          "calibrated": bool(t.get("calibrated")), "status": t.get("status")},
        "calculation_versions": [v.get("version_id") for v in cv.get("versions", [])],
        "files": REGISTRY_FILES,
    }


def _publish_gate(result: dict, wmeta: dict) -> dict:
    """دروازه انتشار: عدد فقط وقتی منتشر می‌شود که همهٔ شروط برقرار باشند.
    (فاز صفر — بند ۴ نقشه راه: انتشار عدد فقط پس از عبور از Gate)"""
    reasons: list[str] = []
    if not wmeta["weight_set"]["calibrated"]:
        reasons.append("وزن‌ها کالیبره نشده‌اند (W-v1, PENDING_VALIDATION)")
    if not wmeta["threshold_set"]["calibrated"]:
        reasons.append("آستانه‌های L/U کالیبره نشده‌اند (T-v1, PENDING_VALIDATION)")
    n_valid = sum(1 for p in result.get("indicators", [])
                  if p["normalized"]["status"] in ("OBSERVED", "PROXY", "ESTIMATED")
                  and p["normalized"]["value"] is not None)
    if n_valid == 0:
        reasons.append("هیچ نمرهٔ استانداردشدهٔ معتبری تولید نشده است")
    aggregate = result.get("aggregates", {}).get("qtr", {}).get("K", {})
    can_publish = (not reasons) and aggregate.get("status") == "OBSERVED"
    return {
        "can_publish_numeric_scores": can_publish,
        "n_valid_standardized_scores": n_valid,
        "reasons": reasons,
        "rule": "kernel = مرجع رسمی محاسبات؛ انتشار عدد بدون گذر از Gate ممنوع است",
    }


def _provenance_of(vid: str) -> dict:
    return _load_json_if(os.path.join(PROV_DIR, f"{vid}.json")) or {}


def _source_category(pv: dict) -> str:
    prov = (str(pv.get("provider", "")) + " " + str(pv.get("source_name", ""))).lower()
    if "openstreetmap" in prov or "osm" in prov:
        return "public_osm"
    if "usgs" in prov or "comcat" in prov or "earthquake" in prov:
        return "scientific_remote_sensing"
    return "auxiliary_proxy"


def _value_scale(pv: dict, op: str) -> str:
    ss = str(pv.get("spatial_scale") or "")
    if op == "nearest_epicenter_distance":
        return "region"
    if "district" in ss:
        return "district"
    return "unknown"


# ------------------------------------------------- pilot records (real data)
def _pilot_dcs() -> dict:
    dcs = _load_json_if(os.path.join(PILOT_OUT, "data_coverage_summary.json"))
    if not dcs:
        raise FileNotFoundError("pilot data_coverage_summary.json missing")
    return dcs


def _pilot_records() -> list[dict]:
    """Same record construction as the MVP-2 pilot run (real fetched measurements)."""
    dcs = _pilot_dcs()
    records = []
    for row in dcs["indicators"]:
        if row["indicator_code"] == "BOUNDARY":
            continue
        vid = row.get("provenance_value_id")
        pv = _provenance_of(vid) if vid else {}
        op = row.get("operationalization")
        records.append({
            "indicator_code": row["indicator_code"],
            "operationalization": op,
            "raw_unit": pv.get("unit") or UNIT_BY_OP.get(op),
            "provenance_value_id": vid,
            "measurement": {"indicator_code": row["indicator_code"],
                            "value": row.get("raw_value"), "status": row.get("raw_status"),
                            "is_proxy": row.get("is_proxy", False),
                            "evidence_stream": [row["evidence_stream"]] if row.get("evidence_stream") else []},
        })
    return records


def _pilot_neighborhood() -> dict:
    return _pilot_dcs()["neighborhood"]


# ------------------------------------------------------- full run pipeline
def run_full_pipeline(records: list[dict], neighborhood: dict | None, data_version: str,
                      weight_override: dict | None = None) -> dict:
    """یک اجرای کامل واقعی از موتورهای kernel: CalcRun + Confidence + Bottleneck.
    هیچ عددی اینجا ساخته نمی‌شود؛ فقط orchestration موتورهای مرجع."""
    cr = CalcRun(REG, weight_override=weight_override,
                 calc_version_registry=CALC_VERSION_REGISTRY, data_version=data_version)
    run = cr.run(records, neighborhood=neighborhood)

    ce = ConfidenceEngine()
    prov_by_val = {r.get("provenance_value_id") or "": _provenance_of(r.get("provenance_value_id") or "")
                   for r in records}
    dcs_cov = {}
    dcs = _load_json_if(os.path.join(PILOT_OUT, "data_coverage_summary.json"))
    if dcs:
        dcs_cov = {r.get("provenance_value_id"): r for r in dcs.get("indicators", [])}

    rec_conf: dict[str, dict] = {}
    for p in run["records"]:
        vid = p["raw"]["provenance_value_id"]
        pv = prov_by_val.get(vid, {})
        # inline provenance supplied by the caller (e.g. TS adapter mapping) —
        # used for confidence assessment when no pilot provenance file exists
        inline_pv = (r.get("provenance") or {} for r in records
                     if (r.get("provenance_value_id") or "") == vid)
        pv = {**(next(inline_pv, {}) or {}), **pv}
        ts = pv.get("timestamp_acquired")
        age = 0
        if ts:
            try:
                age = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(ts)).days)
            except Exception:
                age = 0
        row = dcs_cov.get(vid, {})
        rec_conf[vid] = ce.assess_value(
            has_number=(p["raw"]["value"] is not None and p["raw"]["status"] in ("OBSERVED", "PROXY", "ESTIMATED")),
            source_category=_source_category(pv), is_proxy=p["raw"]["is_proxy"],
            evidence_streams=p["raw"]["evidence_stream"],
            value_scale=pv.get("spatial_scale") or _value_scale(pv, p["operationalization"]), target_scale="neighborhood",
            completeness=row.get("coverage", pv.get("completeness", 1.0)),
            quality_score=row.get("quality_score", pv.get("quality_score")),
            age_days=age, expected_days=365, n_streams_agree=len(p["raw"]["evidence_stream"]), tested=False)

    def agg_conf(agg):
        published = agg.get("value") is not None and agg.get("status") == "OBSERVED"
        cov = (agg.get("coverage_detail") or {}).get("coverage")
        return ce.assess_aggregate(published=published, member_confidences=[], coverage=cov)

    for grp in ("capitals", "caueo", "qtr"):
        for v in run["aggregates"][grp].values():
            v["confidence"] = agg_conf(v)
    run["aggregates"]["equity"]["confidence"] = agg_conf(run["aggregates"]["equity"])

    caueo = {k: {"value": v.get("value"), "status": v.get("status")}
             for k, v in run["aggregates"]["caueo"].items()}
    bottleneck = detect_bottleneck(caueo, base_threshold=60.0,
                                   disaggregation={"capital": False, "location": False,
                                                   "group": False, "time": False},
                                   confidence={"level": "ناکافی", "reason": "C-A-U-E-O abstained"})
    run["aggregates"]["bottleneck"] = bottleneck

    drilldown: dict[str, dict] = {}
    inline_by_val = {(r.get("provenance_value_id") or ""): (r.get("provenance") or {}) for r in records}
    for p in run["records"]:
        vid = p["raw"]["provenance_value_id"]
        pv = {**inline_by_val.get(vid, {}), **prov_by_val.get(vid, {})}
        if not pv:
            # still emit a minimal drilldown so every value has a visible chain
            pv = {"formula_id": p.get("operationalization"), "resulting_value": p["raw"]["value"],
                  "unit": p["raw"]["unit"], "is_proxy": p["raw"]["is_proxy"],
                  "source_name": "(inline adapter payload — no registered provenance file)"}
        drilldown[vid] = {
            "result": {"indicator_code": p["indicator_code"], "operationalization": p["operationalization"],
                       "raw_value": p["raw"]["value"], "raw_unit": p["raw"]["unit"],
                       "standardized_status": p["normalized"]["status"],
                       "standardized_reason": p["normalized"].get("missing_reason")},
            "indicator": {"title": p["title"], "capital": p["capital_code"], "chain_stage": p["chain_stage"],
                          "qtr_target": p["qtr_target"], "direction": p["direction_text"]},
            "formula": pv.get("formula_id"), "raw_value": pv.get("resulting_value"), "unit": pv.get("unit"),
            "source": {"source_id": pv.get("source_id"), "source_name": pv.get("source_name"),
                       "provider": pv.get("provider"), "dataset_id": pv.get("dataset_id")},
            "request_api": {"url_api": pv.get("url_api"), "request_params": pv.get("request_params")},
            "file_record": {"raw_file_ref": pv.get("raw_file_ref"), "raw_file_hash": pv.get("raw_file_hash"),
                            "record_ref": pv.get("record_ref")},
            "date": pv.get("timestamp_acquired"), "observation_period": pv.get("observation_period"),
            "processing": {"processing_version": pv.get("processing_version"),
                           "transformation_steps": pv.get("transformation_steps"), "crs": pv.get("crs")},
            "qc": {"quality_checks": pv.get("quality_checks", []),
                   "quality_score": dcs_cov.get(vid, {}).get("quality_score", pv.get("quality_score"))},
            "confidence": rec_conf.get(vid), "is_proxy": pv.get("is_proxy"),
            "reproducibility_key": run["reproducibility_key"],
        }

    result_records = [{**p, "confidence": rec_conf.get(p["raw"]["provenance_value_id"])}
                      for p in run["records"]]
    result = {
        "run_id": f'{run["calc_run"]["calculation_version_id"]}+{run["fingerprint"].split(":")[1][:12]}',
        "neighborhood": neighborhood or run.get("neighborhood"),
        "calc_run": run["calc_run"],
        "reproducibility_key": run["reproducibility_key"],
        "fingerprint": run["fingerprint"],
        # شکل یکسان با neighborhood_result.json پایلوت (کلید «indicators»)
        "indicators": result_records,
        "aggregates": run["aggregates"],
        "drilldown_index": drilldown,
        "engine": {"stages": CalcRun.STAGE_LIST, "count": len(CalcRun.STAGE_LIST)},
    }
    result["publish_gate"] = _publish_gate(result, _registry_meta())
    return result


# ------------------------------------------------------------ GIS boundary
_BOUNDARY_STORE = None


def _boundary_store():
    """Append-only boundary store (kernel/gis/boundary.py) — service sandbox dir."""
    global _BOUNDARY_STORE
    if _BOUNDARY_STORE is None:
        from gis.boundary import BoundaryStore
        _BOUNDARY_STORE = BoundaryStore(out_dir=os.path.join(SERVICE_OUT, "boundaries"))
    return _BOUNDARY_STORE


# ------------------------------------------------------------ GIS boundary
def _boundary_add_version_impl(self, neighborhood_id: str, body: dict):
    """POST /v1/gis/boundaries/:id — append a boundary version with HARD provenance guard.
    Body: { geometry_geojson, crs, tier, is_official, is_proxy, provenance: {...}, note? }
    provenance_ref is REQUIRED — a boundary without provenance is rejected (constraint 6).
    """
    from gis.boundary import BoundaryProvenanceMissing
    from gis.spatial import validate_crs, validate_topology
    from shapely.geometry import shape

    geom_geo = body.get("geometry_geojson")
    if not isinstance(geom_geo, dict) or "type" not in geom_geo:
        return self._send(*_error("INVALID_INPUT", "geometry_geojson (GeoJSON geometry object) is required"))
    provenance = body.get("provenance") or {}
    provenance_ref = provenance.get("provenance_ref") or provenance.get("value_id")
    if not provenance_ref:
        return self._send(*_error("INVALID_INPUT",
                                  "provenance.provenance_ref is REQUIRED — مرز بدون منشأ پذیرفته نمی‌شود", 422))
    crs = body.get("crs")
    crs_check = validate_crs(crs)
    if crs_check.get("status") != "PASS":
        return self._send(*_error("INVALID_INPUT", f"CRS invalid: {crs_check.get('detail')}", 422,
                                  check=crs_check))
    tier = body.get("tier") or ("official_registry" if body.get("is_official") else "auxiliary_proxy")
    is_proxy = bool(body.get("is_proxy", not body.get("is_official", False)))

    try:
        geom = shape(geom_geo)
        topo = validate_topology(geom)
        if topo.get("status") == "FAIL":
            return self._send(*_error("INVALID_INPUT", f"topology invalid: {topo.get('detail')}", 422,
                                      check=topo))
        bv = _boundary_store().add_version(
            neighborhood_id, geom, crs=crs, tier=tier,
            is_official=bool(body.get("is_official", False)), is_proxy=is_proxy,
            provenance_ref=str(provenance_ref), note=body.get("note", ""))
    except BoundaryProvenanceMissing as e:
        return self._send(*_error("INVALID_INPUT", str(e), 422))
    except Exception as e:
        return self._send(*_error("CALCULATION_BLOCKED", f"boundary registration failed: {e}", 500))

    # register provenance for the boundary value itself (10-level chain)
    prov = _store().register_provenance(
        "BOUNDARY", value_id=str(provenance_ref), resulting_value=None, unit="geometry",
        formula_id="boundary_version", source_name=provenance.get("source_name"),
        provider=provenance.get("provider"), dataset_id=provenance.get("dataset_id"),
        url_api=provenance.get("url_api"), request_params=provenance.get("request_params", {}),
        raw_file_ref=provenance.get("raw_file_ref"), record_ref=provenance.get("record_ref"),
        crs=crs, geographic_extent=provenance.get("geographic_extent"),
        timestamp_acquired=provenance.get("timestamp_acquired") or _now_iso(),
        is_proxy=is_proxy, evidence_class="gis",
        methodology_version=METHODOLOGY_VERSION,
        data_version=body.get("data_version") or f"boundary-{neighborhood_id}",
    )
    return self._send(201, {
        "neighborhood_id": neighborhood_id,
        "version": bv.as_dict(),
        "provenance_value_id": prov.value_id,
        "rule": "append-only — نسخه‌های قبلی هرگز حذف یا بازنویسی نمی‌شوند",
    })


def _boundary_payload(neighborhood_id: str) -> dict | None:
    meta = _load_json_if(os.path.join(PILOT, "pilot_boundary_meta.json"))
    dcs = _load_json_if(os.path.join(PILOT_OUT, "data_coverage_summary.json"))
    neigh = (dcs or {}).get("neighborhood", {})
    if not meta or neighborhood_id not in (neigh.get("id"), "IR-THR-D6"):
        return None
    return {
        "neighborhood_id": neigh.get("id", neighborhood_id),
        "name_fa": meta.get("name_fa"), "name_en": meta.get("name_en"),
        "version_id": neigh.get("boundary_version", "v1"),
        "is_official": False,
        "is_proxy": True,
        "proxy_reason": "مرز رسمی شهرداری = ACCESS_REQUIRED؛ مرز فعلی OSM relation است (پروکسی برچسب‌دار)",
        "metric_crs": meta.get("metric_crs"),
        "area_km2": meta.get("area_km2"),
        "centroid": meta.get("centroid"),
        "geometry_hash": neigh.get("boundary_hash"),
        "provenance": {"provider": meta.get("provider"), "license": meta.get("license"),
                       "url_api": meta.get("url"), "params": meta.get("params"),
                       "raw_hash": meta.get("raw_hash"),
                       "timestamp_acquired": meta.get("timestamp_acquired"),
                       "osm_tags": meta.get("osm_tags")},
        "geometry_geojson": meta.get("geojson"),
        "append_only": True,
    }


# --------------------------------------------------------------- HTTP layer
class Handler(BaseHTTPRequestHandler):
    server_version = "KernelService/0.1"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):  # quieter console
        sys.stderr.write("[kernel] " + (fmt % args) + "\n")

    # ---- plumbing ----
    def _send(self, status: int, payload: dict):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self) -> dict:
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except Exception:
            raise ValueError("invalid JSON body")

    # ---- routes ----
    def do_GET(self):
        path = unquote(urlparse(self.path).path)
        try:
            with _LOCK:
                self._route_get(path)
        except FileNotFoundError as e:
            self._send(*_error("ARTIFACT_MISSING", str(e), 404))
        except Exception as e:  # pragma: no cover
            self._send(*_error("CALCULATION_BLOCKED", f"{type(e).__name__}: {e}", 500))

    def do_POST(self):
        path = unquote(urlparse(self.path).path)
        try:
            body = self._body()
        except ValueError as e:
            self._send(*_error("INVALID_INPUT", str(e), 400))
            return
        try:
            with _LOCK:
                self._route_post(path, body)
        except FileNotFoundError as e:
            self._send(*_error("ARTIFACT_MISSING", str(e), 404))
        except Exception as e:
            self._send(*_error("CALCULATION_BLOCKED", f"{type(e).__name__}: {e}", 500))

    # ---- GET routes ----
    def _route_get(self, path: str):
        if path == "/v1/health":
            meta = _registry_meta()
            return self._send(200, {
                "service": SERVICE_VERSION,
                "status": "ok",
                "kernel_root": KROOT,
                "engine": {"calc_run_family": "CALC-v0.2",
                           "stages": CalcRun.STAGE_LIST},
                "registry_meta": meta,
                "gate_summary": {
                    "weights_calibrated": meta["weight_set"]["calibrated"],
                    "thresholds_calibrated": meta["threshold_set"]["calibrated"],
                    "numeric_publishing_allowed": False,
                    "pilot_gate_decision": (_load_json_if(os.path.join(PILOT_MVP2, "gate_report_mvp2.json")) or {}).get("D_gate_decision"),
                },
                "now": _now_iso(),
            })

        if path == "/v1/registries":
            return self._send(200, {"registries": _registry_meta()})

        m = re.fullmatch(r"/v1/registries/([a-z_0-9]+)", path)
        if m:
            name = m.group(1)
            fname = REGISTRY_FILES.get(name)
            if not fname:
                return self._send(*_error("INVALID_INPUT", f"unknown registry: {name}", 404,
                                          known=sorted(REGISTRY_FILES)))
            data = _load_json(os.path.join(REG, fname))
            limit = TRUNCATE_RECORDS.get(name)
            if limit is not None and isinstance(data.get("records"), list) and len(data["records"]) > limit:
                data = {**data, "records": data["records"][:limit],
                        "records_truncated": True, "records_total": len(data["records"])}
            return self._send(200, {"registry": name, "data": data})

        m = re.fullmatch(r"/v1/calculation-runs/([^/]+)/drilldown/([^/]+)", path)
        if m:
            run_id, vid = m.group(1), m.group(2)
            run = _RUNS.get(run_id)
            if not run:
                return self._send(*_error("INVALID_INPUT", f"unknown run_id: {run_id}", 404))
            dd = run.get("drilldown_index", {}).get(vid)
            if not dd:
                return self._send(*_error("INVALID_INPUT", f"no drilldown for value {vid} in run {run_id}", 404))
            return self._send(200, {"run_id": run_id, "value_id": vid,
                                    "chain_levels": ["result", "indicator", "formula", "raw_value", "source",
                                                     "request", "file_record", "date", "processing", "qc"],
                                    "drilldown": dd})

        m = re.fullmatch(r"/v1/calculation-runs/([^/]+)", path)
        if m:
            run = _RUNS.get(m.group(1))
            if not run:
                return self._send(*_error("INVALID_INPUT", f"unknown run_id: {m.group(1)}", 404))
            return self._send(200, run)

        m = re.fullmatch(r"/v1/gis/boundaries/([^/]+)", path)
        if m:
            payload = _boundary_payload(m.group(1))
            if not payload:
                return self._send(*_error("SOURCE_UNAVAILABLE",
                                          f"no boundary registered for {m.group(1)} (بدون جعل مرز)", 404))
            return self._send(200, payload)

        m = re.fullmatch(r"/v1/gis/boundaries/([^/]+)/versions", path)
        if m:
            store = _boundary_store()
            vs = [v.as_dict() if hasattr(v, "as_dict") else v for v in store.list_versions(m.group(1))]
            return self._send(200, {"neighborhood_id": m.group(1), "versions": vs,
                                    "append_only": True})

        if path == "/v1/gis/rasters":
            from gis.zonal import available_rasters
            return self._send(200, {"rasters": available_rasters()})
        if path == "/v1/pilot/mvp2":
            nr = _load_json_if(os.path.join(PILOT_MVP2, "neighborhood_result.json"))
            gate = _load_json_if(os.path.join(PILOT_MVP2, "gate_report_mvp2.json"))
            cov = _load_json_if(os.path.join(PILOT_MVP2, "coverage_summaries.json"))
            if nr is None or gate is None:
                raise FileNotFoundError("MVP-2 pilot artifacts not found; run kernel/pilot/mvp2_pilot_run.py first")
            return self._send(200, {"neighborhood_result": nr, "gate_report": gate,
                                    "coverage": cov, "artifact_dir": PILOT_MVP2})

        if path == "/v1/gate":
            gate = _load_json_if(os.path.join(PILOT_MVP2, "gate_report_mvp2.json"))
            if gate is None:
                raise FileNotFoundError("gate report missing")
            return self._send(200, gate)

        return self._send(*_error("INVALID_INPUT", f"no route: {path}", 404))

    # ---- POST routes ----
    def _route_post(self, path: str, body: dict):
        if path == "/v1/calculation-runs":
            data_version = str(body.get("data_version") or "").strip()
            if not data_version:
                return self._send(*_error("INVALID_INPUT", "data_version is required"))
            use_pilot = body.get("use_pilot_records", not body.get("records"))
            if use_pilot:
                records = _pilot_records()
                neighborhood = body.get("neighborhood") or _pilot_neighborhood()
            else:
                records = body.get("records") or []
                if not isinstance(records, list) or not records:
                    return self._send(*_error("INVALID_INPUT",
                                              "records must be a non-empty list (or use_pilot_records=true)"))
                neighborhood = body.get("neighborhood")
            result = run_full_pipeline(records, neighborhood, data_version,
                                       weight_override=body.get("weight_override"))
            _RUNS[result["run_id"]] = result
            return self._send(200, result)

        if path == "/v1/ingestion/validate":
            return self._ingestion_validate(body)

        if path == "/v1/ingestion/approve":
            return self._ingestion_approve(body)

        m = re.fullmatch(r"/v1/gis/boundaries/([^/]+)", path)
        if m:
            return _boundary_add_version_impl(self, m.group(1), body)

        if path == "/v1/gis/zonal-stats":
            return self._zonal_stats(body)

        return self._send(*_error("INVALID_INPUT", f"no route: {path}", 404))

    # ---- zonal stats ----
    def _zonal_stats(self, body: dict):
        from gis.zonal import ZonalError, zonal_stats
        geometry = body.get("geometry")
        raster_id = body.get("raster_id")
        if not isinstance(geometry, dict) or not isinstance(raster_id, str):
            return self._send(*_error("INVALID_INPUT", "geometry و raster_id لازم است"))
        try:
            city = body.get("city") if isinstance(body.get("city"), str) else None
            groups = body.get("class_groups") if isinstance(body.get("class_groups"), dict) else None
            result = zonal_stats(raster_id, geometry, body.get("cell_centers"), body.get("cell_size_m"), body.get("threshold"), city, groups)
        except ZonalError as exc:
            return self._send(*_error(exc.code, str(exc), 422))
        return self._send(200, {"result": result, "computed_at": _now_iso()})

    # ---- ingestion ----
    def _ingestion_validate(self, body: dict):
        indicator_code = body.get("indicator_code")
        if not indicator_code:
            return self._send(*_error("INVALID_INPUT", "indicator_code is required"))
        if "raw_value" not in body:
            return self._send(*_error("INVALID_INPUT", "raw_value is required (use null for missing)"))

        r419 = _load_json(os.path.join(REG, "registry_419.json"))
        cf = r419["code_field"]
        reg_row = next((r for r in r419["records"] if r.get(cf) == indicator_code), None)

        svc = IngestionService(store=_store(), registries_dir=REG)
        rec = svc.ingest_value(
            indicator_code=indicator_code,
            raw_value=body.get("raw_value"),
            rows_for_column=body.get("rows") or [{}],
            value_field=body.get("value_field") or "value",
            source_id=body.get("source_id") or "SRC-SERVICE",
            request_params=body.get("request_params") or {"dataset_id": body.get("dataset_id", "service-request")},
            declared_unit=body.get("declared_unit"),
            registry_unit=(reg_row or {}).get("واحد اصلی"),
            raw_bytes=(body.get("raw_bytes_b64") or "").encode() or None,
            raw_file_ref=body.get("raw_file_ref"),
            record_ref=body.get("record_ref"),
            evidence_class=body.get("evidence_class") or "objective",
            is_proxy=bool(body.get("is_proxy", False)),
            spatial_scale=body.get("spatial_scale"),
            crs=body.get("crs"),
            timestamp_acquired=body.get("timestamp_acquired"),
            observation_period=body.get("observation_period"),
            force_manual_approval=bool(body.get("force_manual_approval", False)),
            data_version=body.get("data_version") or "service-input",
            indicator_version="registry-419-v1",
            weight_v="W-v1", threshold_v="T-v1", calc_v="CALC-v0.2",
        )
        gate = svc.can_feed_calculation(rec)
        _INGEST_RECORDS[rec.provenance_value_id] = rec.as_dict()
        return self._send(200, {
            "record": rec.as_dict(),
            "gate": gate,
            "registry_unit": (reg_row or {}).get("واحد اصلی"),
            "registry_title": (reg_row or {}).get("عنوان شاخص"),
            "rule": "INVALID/missing هرگز صفر نمی‌شود؛ داده بدون تأیید وارد محاسبه نمی‌شود",
        })

    def _ingestion_approve(self, body: dict):
        vid = body.get("provenance_value_id")
        decision = str(body.get("decision") or "").upper()
        approver = body.get("approver")
        if not vid or vid not in _INGEST_RECORDS:
            return self._send(*_error("INVALID_INPUT", f"unknown provenance_value_id: {vid}", 404))
        if decision not in ("APPROVE", "REJECT"):
            return self._send(*_error("INVALID_INPUT", "decision must be APPROVE or REJECT"))
        if not approver:
            return self._send(*_error("INVALID_INPUT", "approver is required (audit trail)"))
        stored = _INGEST_RECORDS[vid]
        if stored["measurement"]["status"] == "INVALID":
            return self._send(*_error("INVALID_INPUT", "cannot approve an INVALID record (blocked by validators)", 422))

        # بازسازی دقیق همان رکورد (بدون ingest مجدد) و اعمال تصمیم انسانی روی آن
        svc = IngestionService(store=_store(), registries_dir=REG)
        m = stored["measurement"]
        rec = IngestionRecord(
            dataset_id=stored["dataset_id"], indicator_code=stored["indicator_code"],
            measurement=Measurement(indicator_code=m["indicator_code"], value=m["value"],
                                    status=m["status"], is_proxy=m["is_proxy"],
                                    missing_reason=m.get("missing_reason"),
                                    spatial_scale=m.get("spatial_scale"),
                                    downscaling_caveat=m.get("downscaling_caveat"),
                                    evidence_stream=list(m.get("evidence_stream") or []),
                                    group=m.get("group")),
            provenance_value_id=stored["provenance_value_id"],
            quality_checks=list(stored.get("quality_checks") or []),
            quality_score=dict(stored.get("quality_score") or {}),
            unmapped_columns=list(stored.get("unmapped_columns") or []),
            approval_status=stored.get("approval_status", "PENDING_APPROVAL"),
            approval_note=stored.get("approval_note", ""),
        )
        if decision == "APPROVE":
            svc.approve(rec, approver, body.get("note", ""))
        else:
            svc.reject(rec, approver, body.get("note", ""))
        gate = svc.can_feed_calculation(rec)
        _INGEST_RECORDS[vid] = rec.as_dict()
        return self._send(200, {"record": rec.as_dict(), "gate": gate,
                                "decision": "APPROVED" if decision == "APPROVE" else "REJECTED"})


class _ReusableThreadingHTTPServer(ThreadingHTTPServer):
    """سرور HTTP با اتصال مجدد سریع به پورت پس از ری‌استارت (رفع TIME_WAIT)."""
    allow_reuse_address = True


def main():
    port = DEFAULT_PORT
    server = _ReusableThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"[kernel] kernel core service listening on http://127.0.0.1:{port}  ({SERVICE_VERSION})")
    print(f"[kernel] kernel root: {KROOT}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
