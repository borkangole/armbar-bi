"""
ArmBar BI - Data preparation / integration layer.

RAW source exports  ->  cleaned star schema (data/clean/*.csv + ArmBar_BI_Dataset.xlsx)
                    ->  data-quality log   (data/clean/data_quality_log.csv)
                    ->  dashboard feed      (web/data/armbar-data.js)

Run:  python pipeline/prepare.py            (add --no-xlsx to skip the Excel export)
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
RAW, CLEAN, WEB = ROOT / "data/raw", ROOT / "data/clean", ROOT / "web/data"
CLEAN.mkdir(parents=True, exist_ok=True); WEB.mkdir(parents=True, exist_ok=True)

START, END = pd.Timestamp("2025-01-01"), pd.Timestamp("2026-06-30")
RENEWAL_GRACE_DAYS = 14          # renewed = paid again within 14 days of expiry (or before it)
dq = []                          # data-quality log

def log(issue_id, table, issue, rows, treatment, impact):
    dq.append(dict(issue_id=issue_id, source_table=table, issue=issue, rows_affected=int(rows),
                   treatment=treatment, bi_impact_if_untreated=impact))

# ------------------------------------------------------------------ load
branches = pd.read_csv(RAW / "master/branches.csv")
plans = pd.read_csv(RAW / "master/membership_plans.csv")
products = pd.read_csv(RAW / "master/bar_products.csv")
members = pd.read_csv(RAW / "gym_system/members.csv", parse_dates=["join_date"])
pay = pd.read_csv(RAW / "gym_system/membership_payments.csv", dtype={"plan_id": str, "payment_date": str})
svc = pd.read_csv(RAW / "gym_system/gym_services.csv", parse_dates=["service_date"])
visits = pd.read_csv(RAW / "gym_system/gym_visits_daily.csv", parse_dates=["visit_date"])
bar = pd.read_csv(RAW / "bar_pos/bar_sales_lines.csv", dtype={"member_id": str, "branch_code": str})
opex = pd.read_csv(RAW / "finance/operating_expenses.csv")

# ------------------------------------------------------------------ DQ-1 branch codes
valid = set(branches.branch_id)
code = bar.branch_code.str.strip().str.upper()
code = code.replace({"ILOILO": "B02", "B-03": "B03", "MNL": "B05"})
n_bad = int((bar.branch_code != code).sum())
bar["branch_id"] = code
assert set(bar.branch_id) <= valid, set(bar.branch_id) - valid
log("DQ-1", "bar_sales_lines", "Branch code typed inconsistently in POS (e.g. 'b02', 'ILOILO', 'B-03', 'MNL', trailing spaces)",
    n_bad, "Trimmed, upper-cased and mapped aliases to master branch_id; unmapped codes fail the load",
    "Sales split across phantom branches; Iloilo/Kalibo/Manila revenue understated")

# ------------------------------------------------------------------ DQ-2 duplicate lines
before = len(bar)
bar = bar.drop_duplicates()
log("DQ-2", "bar_sales_lines", "Exact duplicate POS lines created by offline re-sync", before - len(bar),
    "Removed exact duplicates (same txn, time, product, qty, amount)",
    "Bar revenue and transaction counts overstated")

# ------------------------------------------------------------------ DQ-4 voids as negative lines
neg = bar[bar.qty < 0].copy()
pos = bar[bar.qty > 0].copy()
key = ["txn_id", "line_no", "product_id", "abs_qty"]
neg["abs_qty"] = -neg.qty; pos["abs_qty"] = pos.qty
neg["k"] = neg.groupby(key).cumcount(); pos["k"] = pos.groupby(key).cumcount()
matched = pos.merge(neg[key + ["k"]], on=key + ["k"], how="left", indicator=True)
voided_lines = int((matched._merge == "both").sum())
bar = matched[matched._merge == "left_only"].drop(columns=["abs_qty", "k", "_merge"])
log("DQ-4", "bar_sales_lines", "Voided items exported as negative-quantity lines", len(neg),
    f"Each void netted against its original line ({voided_lines} originals removed); voids tracked separately",
    "Revenue overstated if negatives ignored; product quantities distorted")

# ------------------------------------------------------------------ DQ-3 discounted but no member id
bar["member_id"] = bar.member_id.fillna("")
unid = (bar.discount_amount > 0) & (bar.member_id == "")
bar["is_member_sale"] = ((bar.member_id != "") | (bar.discount_amount > 0)).astype(int)
bar["member_unidentified"] = unid.astype(int)
log("DQ-3", "bar_sales_lines", "Member discount applied but member_id not captured at POS", unid.sum(),
    "Classified as member sale (discount proves membership); flagged member_unidentified=1; cashier training recommended",
    "Member share of Bar sales understated; cannot link spend to individual member")

# ------------------------------------------------------------------ DQ-5 payment dates & plan ids
raw_dates = pay.payment_date.copy()
iso = pd.to_datetime(raw_dates, format="%Y-%m-%d", errors="coerce")
us = pd.to_datetime(raw_dates, format="%m/%d/%Y", errors="coerce")
pay["payment_date"] = iso.fillna(us)
log("DQ-5a", "membership_payments", "Mixed date formats (Kalibo manual sheet uses MM/DD/YYYY)",
    iso.isna().sum(), "Parsed both formats explicitly into ISO dates; rejected rows would be logged",
    "Kalibo payments dropped or assigned to wrong month")
assert pay.payment_date.notna().all()
blank = pay.plan_id.isna() | (pay.plan_id == "")
price_to_plan = plans.set_index("price").plan_id
pay.loc[blank, "plan_id"] = pay.loc[blank, "amount"].map(price_to_plan)
log("DQ-5b", "membership_payments", "Blank plan_id on manually encoded payments", blank.sum(),
    "Inferred plan from amount (each plan has a unique price)",
    "Revenue by plan incomplete; renewal expiry cannot be computed")

# ------------------------------------------------------------------ enrich facts
products_i = products.set_index("product_id")
bar["txn_datetime"] = pd.to_datetime(bar.txn_datetime)
bar["txn_date"] = bar.txn_datetime.dt.normalize()
bar["line_cost"] = bar.qty * bar.product_id.map(products_i.unit_cost)
bar["gross_sales"] = bar.qty * bar.unit_price
bar["gross_profit"] = bar.net_amount - bar.line_cost
bar = bar[["txn_id", "line_no", "txn_datetime", "txn_date", "branch_id", "member_id", "is_member_sale",
           "member_unidentified", "product_id", "qty", "unit_price", "gross_sales",
           "discount_amount", "net_amount", "line_cost", "gross_profit"]].sort_values(["txn_datetime", "txn_id"])

dur = plans.set_index("plan_id").duration_months
pay["period_end"] = [d + pd.DateOffset(months=int(dur[p])) for d, p in zip(pay.payment_date, pay.plan_id)]
pay = pay.sort_values(["member_id", "payment_date"]).reset_index(drop=True)

# membership expiries -> renewal fact
pay["next_payment"] = pay.groupby("member_id").payment_date.shift(-1)
exp = pay[(pay.period_end >= START) & (pay.period_end <= END)].copy()
exp["renewed"] = (exp.next_payment.notna() &
                  (exp.next_payment <= exp.period_end + pd.Timedelta(days=RENEWAL_GRACE_DAYS))).astype(int)
exp["observable"] = (exp.period_end <= END - pd.Timedelta(days=RENEWAL_GRACE_DAYS)).astype(int)
censored = int((exp.observable == 0).sum())
log("DQ-6", "membership_payments (derived)", "Memberships expiring in the last 14 days cannot show a renewal yet (right-censoring)",
    censored, "Excluded from Renewal Rate until the 14-day grace window has passed (observable=0)",
    "Latest month's renewal rate falsely low -> false alarm")
renewals = exp[["member_id", "branch_id", "plan_id", "payment_id", "period_end", "renewed", "observable"]] \
    .rename(columns={"payment_id": "expiring_payment_id", "period_end": "expiry_date"})

pay_window = pay[pay.payment_date >= START]
log("INFO", "membership_payments", "Payments dated before Jan-2025 (history)", (pay.payment_date < START).sum(),
    "Kept only to compute expiry/renewal; excluded from revenue", "-")

# active members (end of month)
months = pd.date_range(START, END, freq="MS")
month_ends = months + pd.offsets.MonthEnd(0)
active_rows = []
for b in branches.branch_id:
    pb = pay[pay.branch_id == b]
    for mi, me in enumerate(month_ends):
        n = pb[(pb.payment_date <= me) & (pb.period_end > me)].member_id.nunique()
        active_rows.append((mi, b, n))
active = pd.DataFrame(active_rows, columns=["mi", "branch_id", "active_members"])

# ------------------------------------------------------------------ write clean star schema
dim_date = pd.DataFrame({"date": pd.date_range(START, END, freq="D")})
dim_date["year"] = dim_date.date.dt.year
dim_date["month_num"] = dim_date.date.dt.month
dim_date["month"] = dim_date.date.dt.strftime("%Y-%m")
dim_date["month_name"] = dim_date.date.dt.strftime("%b %Y")
dim_date["quarter"] = "Q" + dim_date.date.dt.quarter.astype(str) + " " + dim_date.year.astype(str)
dim_date["weekday"] = dim_date.date.dt.day_name()
dim_date["is_weekend"] = dim_date.date.dt.dayofweek.isin([4, 5]).astype(int)   # Fri/Sat bar nights

members_out = members.drop(columns=["full_name"])   # PII minimised for BI layer
log("PRIV", "members", "Member full names present in source", len(members),
    "Dropped from BI dataset (not needed for any KPI); member_id kept as pseudonymous key", "Unnecessary personal data exposure")

tables = {
    "dim_branch": branches, "dim_date": dim_date, "dim_membership_plan": plans,
    "dim_bar_product": products, "dim_member": members_out,
    "fact_bar_sales": bar,
    "fact_membership_payments": pay_window.drop(columns=["next_payment"]),
    "fact_membership_renewals": renewals,
    "fact_gym_services": svc.rename(columns={"trainer_or_direct_cost": "direct_cost"}),
    "fact_gym_visits_daily": visits,
    "fact_operating_expenses": opex,
}
for name, df in tables.items():
    df.to_csv(CLEAN / f"{name}.csv", index=False, date_format="%Y-%m-%d")
dq_df = pd.DataFrame(dq)
dq_df.to_csv(CLEAN / "data_quality_log.csv", index=False)

if "--no-xlsx" not in sys.argv:
    with pd.ExcelWriter(CLEAN / "ArmBar_BI_Dataset.xlsx", engine="openpyxl") as xw:
        for name, df in tables.items():
            out = df.copy()
            if name == "fact_bar_sales":
                out["txn_datetime"] = out.txn_datetime.dt.strftime("%Y-%m-%d %H:%M")
            out.to_excel(xw, sheet_name=name[:31], index=False)
        dq_df.to_excel(xw, sheet_name="data_quality_log", index=False)

# ------------------------------------------------------------------ dashboard feed (monthly aggregates)
M = {m.strftime("%Y-%m"): i for i, m in enumerate(months)}
B = {b: i for i, b in enumerate(branches.branch_id)}
P = {p: i for i, p in enumerate(products.product_id)}
PL = {p: i for i, p in enumerate(plans.plan_id)}
S = {s: i for i, s in enumerate(["Personal Training", "Group Class", "Day Pass"])}
mkey = lambda s: s.dt.strftime("%Y-%m").map(M)

bar["mi"] = mkey(bar.txn_date); bar["bi"] = bar.branch_id.map(B)
bar["mem_net"] = bar.net_amount * bar.is_member_sale
bp = bar.groupby(["mi", "bi", bar.product_id.map(P)]).agg(
    qty=("qty", "sum"), rev=("net_amount", "sum"), cost=("line_cost", "sum"),
    disc=("discount_amount", "sum"), mem_rev=("mem_net", "sum")).reset_index()
txn = bar.groupby("txn_id").agg(mi=("mi", "first"), bi=("bi", "first"), mem=("is_member_sale", "max"),
                                net=("net_amount", "sum"), gross=("gross_sales", "sum"), disc=("discount_amount", "sum"))
bm = txn.groupby(["mi", "bi"]).agg(txns=("net", "size"), mem_txns=("mem", "sum"),
                                  gross=("gross", "sum"), disc=("disc", "sum"), net=("net", "sum")).reset_index()

pw = pay_window.copy(); pw["mi"] = mkey(pw.payment_date); pw["bi"] = pw.branch_id.map(B)
pw["new"] = (pw.payment_type == "New").astype(int); pw["ren"] = 1 - pw["new"]
pm = pw.groupby(["mi", "bi", pw.plan_id.map(PL)]).agg(new=("new", "sum"), ren=("ren", "sum"),
                                                      rev=("amount", "sum")).reset_index()
svc["mi"] = mkey(svc.service_date); svc["bi"] = svc.branch_id.map(B)
sm = svc.groupby(["mi", "bi", svc.service_type.map(S)]).agg(n=("amount", "size"), rev=("amount", "sum"),
                                                           cost=("trainer_or_direct_cost", "sum")).reset_index()
ro = renewals[renewals.observable == 1].copy()
ro["mi"] = mkey(ro.expiry_date); ro["bi"] = ro.branch_id.map(B)
rm = ro.groupby(["mi", "bi"]).agg(due=("renewed", "size"), renewed=("renewed", "sum")).reset_index()
visits["mi"] = mkey(visits.visit_date); visits["bi"] = visits.branch_id.map(B)
vm = visits.groupby(["mi", "bi"]).check_ins.sum().reset_index()
am = active.assign(bi=active.branch_id.map(B)).merge(vm, on=["mi", "bi"])
opex["mi"] = opex.month.map(M); opex["bi"] = opex.branch_id.map(B); opex["u"] = (opex.business_unit == "Bar").astype(int)
om = opex.groupby(["mi", "bi", "u"]).amount.sum().reset_index()

r = lambda df, cols: [[round(float(v), 2) if isinstance(v, float) else int(v) for v in row]
                      for row in df[cols].itertuples(index=False)]
feed = {
    "generated": pd.Timestamp.now().strftime("%Y-%m-%d"),
    "months": list(M), "memberDiscountStart": "2026-01",
    "branches": branches[["branch_id", "branch_name", "region"]].to_dict("records"),
    "products": products[["product_id", "product_name", "category"]].to_dict("records"),
    "plans": plans[["plan_id", "plan_name"]].to_dict("records"),
    "services": list(S),
    "barProduct": {"cols": ["mi", "bi", "pi", "qty", "rev", "cost", "disc", "memRev"],
                   "rows": r(bp, ["mi", "bi", "product_id", "qty", "rev", "cost", "disc", "mem_rev"])},
    "barMonth": {"cols": ["mi", "bi", "txns", "memTxns", "gross", "disc", "net"],
                 "rows": r(bm, ["mi", "bi", "txns", "mem_txns", "gross", "disc", "net"])},
    "planMonth": {"cols": ["mi", "bi", "pli", "new", "ren", "rev"],
                  "rows": r(pm, ["mi", "bi", "plan_id", "new", "ren", "rev"])},
    "serviceMonth": {"cols": ["mi", "bi", "si", "n", "rev", "cost"],
                     "rows": r(sm, ["mi", "bi", "service_type", "n", "rev", "cost"])},
    "renewMonth": {"cols": ["mi", "bi", "due", "renewed"], "rows": r(rm, ["mi", "bi", "due", "renewed"])},
    "activeMonth": {"cols": ["mi", "bi", "active", "checkins"],
                    "rows": r(am, ["mi", "bi", "active_members", "check_ins"])},
    "opexMonth": {"cols": ["mi", "bi", "u", "amount"], "rows": r(om, ["mi", "bi", "u", "amount"])},
    "dataQuality": dq_df.to_dict("records"),
}
(WEB / "armbar-data.js").write_text("window.ARMBAR_DATA = " + json.dumps(feed, separators=(",", ":")) + ";\n")

print(dq_df[["issue_id", "rows_affected"]].to_string(index=False))
print({k: len(v) for k, v in tables.items()})
