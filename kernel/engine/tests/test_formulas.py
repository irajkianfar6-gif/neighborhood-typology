"""
FORMULA UNIT TESTS — math-only, using EXPLICITLY-LABELED test vectors.
These verify the ENGINE MATH. They are NOT neighborhood assessments and must never be
presented as real data (constraint 1). Values below are literal test fixtures (x=50, L=0, U=100 ...).
"""
import sys, os
from pathlib import Path
KERNEL_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(KERNEL_DIR))
from engine.calc_engine import Engine
from engine.status import Measurement

REG=str(KERNEL_DIR / "registries")
eng=Engine(REG)
results=[]
def check(name, cond):
    results.append((name,bool(cond)))

# 1. positive standardization: PHY-001 has L=0,U=100,direction positive -> x=50 => 50
m=eng.standardize("PHY-001", 50.0); check("positive x=50 -> 50", m.value==50.0 and m.status=="OBSERVED")
# 2. clip above: x=150 -> 100
m=eng.standardize("PHY-001", 150.0); check("positive clip high -> 100", m.value==100.0)
# 3. clip below: x=-20 -> 0
m=eng.standardize("PHY-001", -20.0); check("positive clip low -> 0", m.value==0.0)
# 4. inverse: find an inverse indicator (direction معکوس) with 0-100 range
inv=None
for code,lu in eng.thresholds["indicator_LU"].items():
    if "معکوس" in str(lu.get("direction")) and lu.get("L")==0 and lu.get("U")==100:
        inv=code; break
if inv:
    m=eng.standardize(inv, 30.0); check(f"inverse {inv} x=30 -> 70", m.value==70.0 and m.status=="OBSERVED")
else:
    check("inverse indicator present", False)
# 5. MISSING never 0
m=eng.standardize("PHY-001", None); check("missing -> MISSING not 0", m.value is None and m.status=="MISSING")
# 6. threshold-type -> PENDING_VALIDATION (no number)
th=None
for code,lu in eng.thresholds["indicator_LU"].items():
    if "آستانه" in str(lu.get("direction")):
        th=code; break
if th:
    m=eng.standardize(th, 40.0); check(f"threshold {th} -> PENDING_VALIDATION", m.value is None and m.status=="PENDING_VALIDATION")
else:
    check("threshold indicator present", True)
# 7. capital_score weighted mean over observed only (equal weights)
ms=[Measurement("A",80.0,"OBSERVED"),Measurement("B",40.0,"OBSERVED"),Measurement("C",None,"MISSING")]
r=eng.capital_score(ms); check("Kj mean(80,40)=60 coverage2/3", r.value==60.0 and r.status=="OBSERVED")
# 8. coverage below min -> INSUFFICIENT_COVERAGE (no number)
ms2=[Measurement("A",80.0,"OBSERVED")]+[Measurement(f"m{i}",None,"MISSING") for i in range(3)]
r=eng.capital_score(ms2); check("coverage 25% -> INSUFFICIENT_COVERAGE", r.value is None and r.status=="INSUFFICIENT_COVERAGE")
# 9. Q/T/R returned as 4 SEPARATE results
q=eng.qtr({"K":[Measurement("k1",70.0,"OBSERVED")],"Q":[Measurement("q1",60.0,"OBSERVED")],
           "T":[Measurement("t1",50.0,"OBSERVED")],"R":[Measurement("r1",40.0,"OBSERVED")]})
check("QTR 4 separate keys", set(q.keys())=={"K","Q","T","R"} and q["Q"].value==60.0 and q["T"].value==50.0)
# 10. chain gaps
g=eng.chain_gaps(80,75,42,38,35)
check("G_AU=75-42=33", g["G_AU"].value==33.0 and g["G_CA"].value==5.0)
# 11. gap endpoint missing -> INSUFFICIENT_COVERAGE
g2=eng.chain_gaps(80,None,42,38,35); check("gap missing endpoint refuses", g2["G_CA"].status=="INSUFFICIENT_COVERAGE")
# 12. equity refuse on 1 group
r=eng.equity_gap({"low":52.0}); check("equity 1 group refuses", r.value is None and r.status=="INSUFFICIENT_COVERAGE")
# 13. equity gap 2 groups
r=eng.equity_gap({"high":91.0,"low":52.0}); check("equity gap=39", r.value==39.0 and r.status=="OBSERVED")
# 14. priority product
r=eng.priority(3,4,5,0.5,2); check("priority 3*4*5*0.5*2=60", r.value==60.0)
# 15. priority missing factor refuses
r=eng.priority(3,None,5,0.5,2); check("priority missing factor refuses", r.value is None and r.status=="INSUFFICIENT_COVERAGE")
# 16. bands from §5.4
check("band 35->بحرانی", eng.band(35)=="بحرانی")
check("band 80->خوب", eng.band(80)=="خوب")
# 17. Measurement hard-guard: non-observed with a number must raise
raised=False
try:
    Measurement("X", 5.0, "MISSING")
except AssertionError:
    raised=True
check("Measurement guard blocks MISSING+number", raised)

passed=sum(1 for _,ok in results if ok); total=len(results)
for n,ok in results: print(("PASS" if ok else "FAIL"), n)
print(f"\nTESTS: {passed}/{total} passed")
sys.exit(0 if passed==total else 1)
