"""
ArmBar BI - Simulated source-system data generator.

Produces the RAW exports that ArmBar's separate systems would hand over:
  gym_system/   members.csv, membership_payments.csv, gym_services.csv, gym_visits_daily.csv
  bar_pos/      bar_sales_lines.csv
  finance/      operating_expenses.csv
  master/       branches.csv, membership_plans.csv, bar_products.csv

Realistic data-quality problems are injected on purpose (see DQ-1..DQ-5 below)
so the preparation step (prepare.py) has real cleaning work to do.

Run:  python pipeline/generate_raw.py
"""
from pathlib import Path
import numpy as np
import pandas as pd

SEED = 216
rng = np.random.default_rng(SEED)
ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"

START, END = pd.Timestamp("2025-01-01"), pd.Timestamp("2026-06-30")
DAYS = pd.date_range(START, END, freq="D")
MEMBER_DISCOUNT_START = pd.Timestamp("2026-01-01")   # 15% Bar discount for gym members
MEMBER_DISCOUNT = 0.15

# ---------------------------------------------------------------- master data
branches = pd.DataFrame([
    # id,  name,          region,        opened,      HQ, base members, bar txns/day, gym opex, bar opex
    ("B01", "Roxas City", "Panay Island", "2019-06-01", 1, 430, 27, 250_000, 245_000),
    ("B02", "Iloilo City", "Panay Island", "2020-11-01", 0, 500, 32, 290_000, 285_000),
    ("B03", "Kalibo",     "Panay Island", "2022-04-01", 0, 240, 21, 165_000, 200_000),
    ("B04", "Cebu City",  "Cebu",         "2024-03-01", 0, 380, 25, 330_000, 290_000),
    ("B05", "Manila",     "Metro Manila", "2024-08-01", 0, 420, 30, 385_000, 350_000),
], columns=["branch_id", "branch_name", "region", "opened_date", "is_hq",
            "x_base_members", "x_bar_txn_day", "x_gym_opex", "x_bar_opex"])

plans = pd.DataFrame([
    ("P1", "Monthly",        1, 1_500),
    ("P2", "Student Monthly", 1, 1_100),
    ("P3", "Quarterly",      3, 4_000),
    ("P4", "Semi-Annual",    6, 7_500),
    ("P5", "Annual",        12, 13_500),
], columns=["plan_id", "plan_name", "duration_months", "price"])
plan_mix = np.array([0.34, 0.14, 0.26, 0.14, 0.12])

products = pd.DataFrame([
    ("D01", "San Miguel Pale Pilsen", "Beer",          95, 40),
    ("D02", "San Mig Light",          "Beer",          95, 41),
    ("D03", "Red Horse",              "Beer",         100, 43),
    ("D04", "Craft IPA",              "Beer",         190, 92),
    ("D05", "Mojito",                 "Cocktails",    230, 62),
    ("D06", "Long Island Iced Tea",   "Cocktails",    290, 88),
    ("D07", "House Margarita",        "Cocktails",    250, 72),
    ("D08", "Protein Shake",          "Non-Alcoholic", 180, 84),
    ("D09", "Iced Coffee",            "Non-Alcoholic", 120, 34),
    ("D10", "Fresh Fruit Shake",      "Non-Alcoholic", 140, 46),
    ("D11", "Bottled Water",          "Non-Alcoholic",  40, 14),
    ("F01", "Pork Sisig",             "Food",         260, 118),
    ("F02", "Chicken Wings",          "Food",         290, 138),
    ("F03", "Loaded Nachos",          "Food",         230, 88),
    ("F04", "Grilled Chicken Bowl",   "Food",         250, 126),
    ("F05", "Calamares",              "Food",         240, 104),
], columns=["product_id", "product_name", "category", "unit_price", "unit_cost"])
# purchase weights: non-members vs gym members (members lean to shakes/bowls/water)
w_non = np.array([10, 8, 9, 3, 6, 4, 4, 2, 4, 4, 3, 7, 7, 6, 2, 5], float)
w_mem = np.array([5, 7, 3, 2, 4, 2, 2, 12, 6, 7, 8, 4, 5, 3, 10, 3], float)
w_non /= w_non.sum(); w_mem /= w_mem.sum()

# renewal probability by branch over time (t = 0 at Jan-2025, 1 at Jun-2026)
def renew_prob(bid, when):
    t = (when - START).days / (END - START).days
    base = {"B01": 0.78, "B02": 0.77, "B03": 0.73, "B04": 0.75, "B05": 0.73}[bid]
    drift = {"B04": -0.22, "B05": -0.17}.get(bid, 0.0)       # Cebu & Manila eroding
    return float(np.clip(base + drift * t + rng.normal(0, 0.03), 0.3, 0.95))

def month_season(m):         # new-member seasonality (Jan resolutions, summer body)
    return {1: 1.6, 2: 1.2, 3: 1.15, 4: 1.2, 5: 1.1, 6: 0.9, 7: 0.85,
            8: 0.85, 9: 0.9, 10: 0.9, 11: 0.8, 12: 0.7}[m]

# ---------------------------------------------------------------- members & payments
first_names = ["Juan", "Maria", "Jose", "Ana", "Mark", "Kristine", "John", "Angel", "Paolo",
               "Jasmine", "Carlo", "Nicole", "Miguel", "Andrea", "Rafael", "Bea", "Kevin",
               "Camille", "Ramon", "Patricia", "Joshua", "Erika", "Luis", "Trisha"]
last_names = ["Santos", "Reyes", "Cruz", "Bautista", "Villanueva", "Garcia", "Mendoza",
              "Torres", "Castillo", "Flores", "Ramos", "Aquino", "Navarro", "Dela Cruz",
              "Fernandez", "Gonzales", "Lopez", "Castro", "Belleza", "Arcenas"]

members, payments = [], []
mid = 0
pid = 0

def add_member(bid, join_date, first_expiry=None, plan_idx=None):
    global mid
    mid += 1
    member_id = f"M{mid:05d}"
    members.append({
        "member_id": member_id, "branch_id": bid, "join_date": join_date.date(),
        "full_name": f"{rng.choice(first_names)} {rng.choice(last_names)}",
        "gender": rng.choice(["M", "F"], p=[0.58, 0.42]),
        "age_group": rng.choice(["18-24", "25-34", "35-44", "45+"], p=[0.33, 0.38, 0.19, 0.10]),
    })
    return member_id

def pay(member_id, bid, plan_i, when, ptype):
    global pid
    pid += 1
    p = plans.iloc[plan_i]
    payments.append({"payment_id": f"PAY{pid:06d}", "member_id": member_id, "branch_id": bid,
                     "plan_id": p.plan_id, "payment_date": when.date(),
                     "payment_type": ptype, "amount": p.price})
    return when + pd.DateOffset(months=int(p.duration_months))

# heap of (expiry_date, member_id, branch_id, plan_idx)
import heapq
queue = []
init_periods = []
for b in branches.itertuples():
    # members already active on 1 Jan 2025, paid earlier (payments outside window not recorded)
    for _ in range(b.x_base_members):
        pi = rng.choice(5, p=plan_mix)
        dur = int(plans.duration_months[pi])
        joined = START - pd.Timedelta(days=int(rng.integers(30, 900)))
        joined = max(joined, pd.Timestamp(b.opened_date))
        expiry = START + pd.Timedelta(days=int(rng.integers(1, 30 * dur)))
        last_paid = expiry - pd.DateOffset(months=dur)          # paid in 2024 (history)
        joined = min(joined, last_paid)
        m = add_member(b.branch_id, joined)
        pay(m, b.branch_id, pi, last_paid, "New" if joined == last_paid else "Renewal")
        queue.append((expiry, m, b.branch_id, pi))
    # new joiners each month
    for month in pd.date_range(START, END, freq="MS"):
        growth = {"B04": 0.975, "B05": 0.98}.get(b.branch_id, 1.0) ** ((month - START).days / 30)
        n_new = rng.poisson(b.x_base_members * 0.082 * month_season(month.month) * growth)
        for _ in range(n_new):
            d = month + pd.Timedelta(days=int(rng.integers(0, month.days_in_month)))
            pi = rng.choice(5, p=plan_mix)
            m = add_member(b.branch_id, d)
            exp = pay(m, b.branch_id, pi, d, "New")
            queue.append((exp, m, b.branch_id, pi))

# process renewals chronologically
heapq.heapify(queue)
while queue:
    exp, m, bid, pi = heapq.heappop(queue)
    if exp > END:
        continue
    if rng.random() < renew_prob(bid, exp):
        when = exp + pd.Timedelta(days=int(rng.integers(-5, 12)))
        if when > END:
            continue
        if rng.random() < 0.15:                        # some switch plans on renewal
            pi = rng.choice(5, p=plan_mix)
        nxt = pay(m, bid, pi, when, "Renewal")
        heapq.heappush(queue, (nxt, m, bid, pi))

members = pd.DataFrame(members)
payments = pd.DataFrame(payments).sort_values("payment_date").reset_index(drop=True)

# active members per branch per day (for visits & services)
mem_periods = []
for mid_, grp in payments.groupby("member_id"):
    for r in grp.itertuples():
        dur = int(plans.set_index("plan_id").duration_months[r.plan_id])
        s = pd.Timestamp(r.payment_date)
        mem_periods.append((r.branch_id, s, s + pd.DateOffset(months=dur)))
active = pd.DataFrame(0, index=DAYS, columns=branches.branch_id)
for bid, s, e in mem_periods:
    s = max(s, START); e = min(e, END + pd.Timedelta(days=1))
    if s < e:
        active.loc[s:e - pd.Timedelta(days=1), bid] += 1

# ---------------------------------------------------------------- gym visits & services
visits, services = [], []
sid = 0
svc_types = [("Personal Training", 650, 380), ("Group Class", 250, 90), ("Day Pass", 150, 20)]
for d in DAYS:
    wk = 0.75 if d.dayofweek == 6 else (1.1 if d.dayofweek < 5 else 0.9)
    for b in branches.itertuples():
        act = active.at[d, b.branch_id]
        v = rng.poisson(act * 0.36 * wk)
        visits.append({"visit_date": d.date(), "branch_id": b.branch_id, "check_ins": v})
        tour = 1.8 if (b.branch_id == "B03" and d.month in (3, 4, 5, 12)) else 1.0
        for name, price, cost in svc_types:
            lam = {"Personal Training": act * 0.010, "Group Class": act * 0.028,
                   "Day Pass": 6 * tour * wk}[name]
            for _ in range(rng.poisson(lam)):
                sid += 1
                services.append({"service_txn_id": f"GS{sid:06d}", "service_date": d.date(),
                                 "branch_id": b.branch_id, "service_type": name,
                                 "amount": price, "trainer_or_direct_cost": cost})
visits = pd.DataFrame(visits)
services = pd.DataFrame(services)

# ---------------------------------------------------------------- bar POS lines
member_ids_by_branch = members.groupby("branch_id").member_id.apply(np.array).to_dict()
lines = []
txn = 0
for d in DAYS:
    months_in = (d.year - 2025) * 12 + d.month - 1
    wk = [0.75, 0.7, 0.8, 0.95, 1.5, 1.8, 1.1][d.dayofweek]
    season = 1.3 if d.month == 12 else (1.12 if d.month in (4, 5) else 1.0)
    for b in branches.itertuples():
        tour = 1.35 if (b.branch_id == "B03" and d.month in (3, 4, 5, 12)) else 1.0
        growth = 1.018 ** months_in
        n = rng.poisson(b.x_bar_txn_day * wk * season * tour * growth)
        disc_on = d >= MEMBER_DISCOUNT_START
        member_p = 0.24 + (0.10 if disc_on else 0.0)
        for _ in range(n):
            txn += 1
            is_mem = rng.random() < member_p
            mem = rng.choice(member_ids_by_branch[b.branch_id]) if is_mem else ""
            hour = int(rng.choice([16, 17, 18, 19, 20, 21, 22, 23],
                                  p=[.05, .09, .15, .17, .18, .16, .12, .08]))
            ts = d + pd.Timedelta(hours=hour, minutes=int(rng.integers(0, 60)))
            for _l in range(rng.choice([1, 2, 3, 4], p=[0.35, 0.35, 0.2, 0.1])):
                pi = rng.choice(len(products), p=w_mem if is_mem else w_non)
                p = products.iloc[pi]
                qty = int(rng.choice([1, 2, 3, 4], p=[0.55, 0.28, 0.12, 0.05]))
                gross = qty * p.unit_price
                disc = round(gross * MEMBER_DISCOUNT, 2) if (is_mem and disc_on) else 0.0
                lines.append((f"T{txn:07d}", _l + 1, ts, b.branch_id, mem, p.product_id, qty,
                              p.unit_price, disc, round(gross - disc, 2)))
bar = pd.DataFrame(lines, columns=["txn_id", "line_no", "txn_datetime", "branch_code", "member_id",
                                   "product_id", "qty", "unit_price", "discount_amount",
                                   "net_amount"])

# ---------------------------------------------------------------- operating expenses
opex = []
for month in pd.date_range(START, END, freq="MS"):
    summer = 1.08 if month.month in (4, 5) else 1.0          # aircon-heavy months
    for b in branches.itertuples():
        for unit, base in (("Gym", b.x_gym_opex), ("Bar", b.x_bar_opex)):
            for cat, share in (("Staff Salaries", 0.48), ("Rent", 0.30),
                               ("Utilities", 0.15), ("Supplies & Maintenance", 0.07)):
                amt = base * share * (summer if cat == "Utilities" else 1.0) * rng.normal(1, 0.04)
                opex.append({"month": month.strftime("%Y-%m"), "branch_id": b.branch_id,
                             "business_unit": unit, "expense_category": cat,
                             "amount": round(amt, 2)})
opex = pd.DataFrame(opex)

# ================================================================ inject DQ issues
# DQ-1  Inconsistent branch codes/names typed into the Bar POS
alias = {"B02": ["B02", "b02", "ILOILO", "B02 "], "B03": ["B03", "B-03"], "B05": ["B05", "MNL"]}
for code, variants in alias.items():
    idx = bar.index[bar.branch_code == code]
    pick = rng.random(len(idx)) < 0.04
    bar.loc[idx[pick], "branch_code"] = rng.choice(variants[1:], pick.sum())
# DQ-2  Duplicate POS lines from offline re-sync (~0.6%)
dups = bar.sample(frac=0.006, random_state=SEED)
bar = pd.concat([bar, dups]).sort_values(["txn_datetime", "txn_id"]).reset_index(drop=True)
# DQ-3  Member discount given but member_id not captured (~4% of discounted lines)
disc_idx = bar.index[bar.discount_amount > 0]
blank = rng.choice(disc_idx, int(len(disc_idx) * 0.04), replace=False)
bar.loc[blank, "member_id"] = ""
# DQ-4  Voided items exported as negative quantity lines
voids = bar.sample(frac=0.003, random_state=SEED + 1).copy()
voids["qty"] *= -1; voids["net_amount"] *= -1; voids["discount_amount"] *= -1
bar = pd.concat([bar, voids]).sort_values(["txn_datetime", "txn_id"]).reset_index(drop=True)
# DQ-5  Kalibo keeps gym payments in a manual spreadsheet -> MM/DD/YYYY dates, some blank plan_id
payments["payment_date"] = payments["payment_date"].astype(str)
k = payments.branch_id == "B03"
payments.loc[k, "payment_date"] = pd.to_datetime(payments.loc[k, "payment_date"]).dt.strftime("%m/%d/%Y")
kb = payments.index[k]
payments.loc[rng.choice(kb, int(len(kb) * 0.03), replace=False), "plan_id"] = ""

# ================================================================ write
for sub in ("gym_system", "bar_pos", "finance", "master"):
    (RAW / sub).mkdir(parents=True, exist_ok=True)
branches.drop(columns=[c for c in branches if c.startswith("x_")]).to_csv(RAW / "master/branches.csv", index=False)
plans.to_csv(RAW / "master/membership_plans.csv", index=False)
products.to_csv(RAW / "master/bar_products.csv", index=False)
members.to_csv(RAW / "gym_system/members.csv", index=False)
payments.to_csv(RAW / "gym_system/membership_payments.csv", index=False)
services.to_csv(RAW / "gym_system/gym_services.csv", index=False)
visits.to_csv(RAW / "gym_system/gym_visits_daily.csv", index=False)
bar["txn_datetime"] = bar.txn_datetime.dt.strftime("%Y-%m-%d %H:%M")
bar.to_csv(RAW / "bar_pos/bar_sales_lines.csv", index=False)
opex.to_csv(RAW / "finance/operating_expenses.csv", index=False)

print(f"members {len(members):,} | payments {len(payments):,} | services {len(services):,} | "
      f"bar lines {len(bar):,} | opex rows {len(opex):,}")
