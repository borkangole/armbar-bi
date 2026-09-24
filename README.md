# ArmBar BI Dashboard (CIS 216 midterm)

A deployable web dashboard for ArmBar (Gym + Bar, 5 branches), built on simulated data covering Jan 2025 to Jun 2026.

```
armbar-bi/
├── web/                  <- THE WEBSITE. Deploy this folder only.
│   ├── index.html        3D landing page
│   ├── dashboard.html    the dashboard (3 tabs)
│   ├── imgs/             photos (.webp)
│   ├── src/site.js       scroll animation source  ->  bundled to js/site.js
│   ├── styles.css        light/dark theme
│   ├── app.js            filters, KPIs, charts, exceptions logic
│   ├── data/armbar-data.js   monthly aggregates (generated, do not edit by hand)
│   └── vendor/chart.umd.min.js   Chart.js 4.5.1 (MIT), bundled so the site works offline
├── pipeline/
│   ├── generate_raw.py   simulates the source-system exports (with deliberate data-quality problems)
│   └── prepare.py        cleans + integrates -> star schema, DQ log, dashboard feed
└── data/
    ├── raw/              "as exported" CSVs: gym_system/, bar_pos/, finance/, master/
    └── clean/            star-schema CSVs + ArmBar_BI_Dataset.xlsx + data_quality_log.csv
```

## 1. Preview it on your laptop

- Quick look: double-click `web/index.html`. Everything works except the 3D effect, because browsers block 3D textures on `file://` pages. You'll see the normal photo instead.
- Full 3D locally: in the project folder run `npx serve web` (needs Node.js) or `python -m http.server -d web 8000`, then open the address it prints.

## 1b. Landing page scroll animations

- **GSAP ScrollTrigger**: headings flip up in 3D, the photo tiles swing in like cards (with parallax inside), the business-unit cards slide in from the side, the five questions become a pinned horizontal 3D carousel, the branch route draws itself, and the final title zooms in.
- **Lenis**: smooth, inertial scrolling.
- With "reduce motion" turned on in the OS, the animations are skipped.
- After editing `src/site.js`, rebuild the bundle:
  `npm i gsap lenis esbuild` then `npx esbuild web/src/site.js --bundle --minify --format=iife --outfile=web/js/site.js`

## 2. Deploy to your domain

The site is plain static files, so any static host works. Pick **one** of the options below.

### Option A: Cloudflare Pages (recommended; free, fast in PH, easy custom domain)
1. Push this project to a GitHub repository (see section 3).
2. In the Cloudflare dashboard, go to **Workers & Pages → Create → Pages → Connect to Git** and pick the repo.
3. Build settings: Framework preset = **None**, Build command = *(leave empty)*, Build output directory = **`web`**.
4. Deploy. You get a URL like `armbar-bi.pages.dev`.
5. In the project, open **Custom domains → Set up a custom domain** and enter e.g. `armbar.yourdomain.com`.
   * If the domain's DNS is already on Cloudflare, the record is added automatically.
   * If not, add this record at your registrar: `CNAME  armbar  →  armbar-bi.pages.dev`.
6. HTTPS is issued automatically, usually within a few minutes.

**No-Git shortcut:** on the Pages create screen, choose **Upload assets** instead of Connect to Git and drag in the `web` folder. You'll need to re-upload it every time the data changes.

### Option B: Netlify
1. Go to https://app.netlify.com/drop and drag in the `web` folder. It deploys instantly.
2. Go to **Domain management → Add a domain** and enter `armbar.yourdomain.com`.
3. At your registrar, add `CNAME  armbar  →  <your-site>.netlify.app`, or follow Netlify's instructions for an apex domain.

### Option C: Vercel
Import the Git repo. Set Framework = **Other** and Output Directory = **`web`**, and leave the build command empty. Then add the domain under **Settings → Domains** and create the CNAME to `cname.vercel-dns.com`.

### Option D: GitHub Pages
Put the contents of `web/` in a `docs/` folder (or at the repo root). Then go to **Settings → Pages → Deploy from branch → /docs**. Add a file named `CNAME` containing `armbar.yourdomain.com`, and at your registrar add `CNAME armbar → <username>.github.io`.

### Option E: Existing web hosting (cPanel / Hostinger, etc.)
Upload the **contents** of `web/` into `public_html/` (or into a subfolder such as `public_html/armbar/`) using File Manager or FTP.

> Using a subdomain like `armbar.yourdomain.com` keeps the project separate from anything else on the domain.
> The page includes `noindex`, so it won't appear in Google results. The data is simulated, so nothing confidential is exposed.

## 3. Push to GitHub (for options A, C, and D)

```bash
cd armbar-bi
git init
git add .
git commit -m "ArmBar BI dashboard"
git branch -M main
git remote add origin https://github.com/<you>/armbar-bi.git
git push -u origin main
```

After this, every `git push` redeploys the site automatically on Cloudflare, Vercel, and GitHub Pages.

## 4. Regenerate or change the data

Requires Python 3.10+ with pandas, numpy, and openpyxl (`pip install pandas numpy openpyxl`).

```bash
python pipeline/generate_raw.py     # re-simulate raw exports (seeded, so output is repeatable)
python pipeline/prepare.py          # clean -> data/clean/*.csv, .xlsx, and web/data/armbar-data.js
```

Then commit and push, or re-upload `web/`. To change the story, edit the parameters at the top of `generate_raw.py`: branch sizes, renewal drift for Cebu and Manila, discount start date, prices, and so on.

## 5. What the dashboard answers

| Page | Answers |
|---|---|
| Performance overview | BQ1 revenue trend by unit · BQ2/3 revenue and operating margin by branch and unit · BQ5 exceptions table (Act now / Watch / On track) |
| Gym & Bar drilldown | Renewal rate by branch (3-month rolling) · effect of the 15% member discount on Bar margin · BQ4 products and plans ranked by contribution |
| Data & KPIs | KPI formulas and the data-quality log (useful during the oral defense) |

Filters: From/To month, Branch, and Business unit. The KPI deltas compare the selected period with the prior period of equal length.

## 6. Power BI

The course requires a `.pbix` (or an approved Excel workbook) as the official dashboard file. Load `data/clean/*.csv`, or the sheets in `ArmBar_BI_Dataset.xlsx`, into Power BI. It uses the same star schema, so the Power BI and web versions will show the same numbers.
Relationships: `dim_branch[branch_id]` 1→* each fact's `branch_id` · `dim_date[date]` 1→* `fact_bar_sales[txn_date]`, `fact_membership_payments[payment_date]`, `fact_gym_services[service_date]`, `fact_gym_visits_daily[visit_date]`, `fact_membership_renewals[expiry_date]` · `dim_bar_product[product_id]` 1→* `fact_bar_sales` · `dim_membership_plan[plan_id]` 1→* payments and renewals · `dim_member[member_id]` 1→* payments and renewals.
