#!/usr/bin/env python3
"""Turn the raw datasets (see fetch_raw.py) into life/src/data.js.

Usage: python3 life/tools/build_data.py <raw_dir> <out_js>

Output is one compact JSON object assigned to window.LIFE_DATA. Every number
the game uses for probabilities comes from here; curated.js only adds names,
school systems and other descriptive detail.
"""
import csv
import gzip
import json
import math
import os
import statistics
import sys

import openpyxl

YEAR = 2026
LT_YEARS = [2026, 2040, 2055, 2075, 2100]
LT_AGES = list(range(10, 101, 5))  # abridged groups 10-14 ... 100+
ASFR_YEARS = [2026, 2050]
ASFR_AGES = ["15-19", "20-24", "25-29", "30-34", "35-39", "40-44", "45-49"]
CD_SHEETS = ["5-14", "15-29", "30-49", "50-59", "60-69", "70+"]
MIN_P14 = 5.0  # thousand 14-year-olds; smaller places are left out (0.05% of the cohort)

# Game cause of death -> WHO GHE codes. "minus" codes are subtracted (the parent minus
# the children that have their own game cause). Whatever is left of "All Causes" is "other".
CAUSES = [
    ("tb", [30], []), ("hiv", [100], []), ("diarrhea", [110], []), ("malaria", [220], []),
    ("infect", [20], [30, 100, 110, 220]), ("resp_inf", [380], []), ("maternal", [420], []),
    ("nutrition", [540], []),
    ("ca_lung", [680], []), ("ca_stomach", [640], []), ("ca_liver", [660], []), ("ca_colon", [650], []),
    ("ca_breast", [700], []), ("ca_cervix", [710], []), ("ca_prostate", [740], []),
    ("ca_pancreas", [670], []), ("ca_esoph", [630], []), ("leukemia", [770], []),
    ("ca_other", [610, 790], [680, 640, 660, 650, 700, 710, 740, 670, 630, 770]),
    ("diabetes", [800], []), ("alcohol", [860], []), ("drugs", [870], []), ("dementia", [950], []),
    ("neuro", [940], [950]), ("ihd", [1130], []), ("stroke", [1140], []),
    ("cvd_other", [1100], [1130, 1140]), ("copd", [1180], []), ("resp_other", [1170], [1180]),
    ("cirrhosis", [1230], []), ("digest", [1210], [1230]), ("kidney", [1270], []),
    ("road", [1530], []), ("drowning", [1570], []), ("falls", [1550], []), ("fire", [1560], []),
    ("poison", [1540], []), ("disaster", [1580], []),
    ("injury_other", [1520], [1530, 1540, 1550, 1560, 1570, 1580]),
    ("suicide", [1610], []), ("homicide", [1620], []), ("war", [1630], []),
]
CAUSE_KEYS = [c[0] for c in CAUSES] + ["other"]

# Places WPP has but WHO GHE does not: borrow the cause mix of a similar country.
CD_PROXY = {"TWN": "KOR", "HKG": "SGP", "MAC": "SGP", "PRI": "USA", "PSE": "JOR", "XKX": "SRB",
            "GUF": "FRA", "GLP": "FRA", "MTQ": "FRA", "REU": "FRA", "MYT": "COM", "NCL": "FJI",
            "PYF": "FJI", "GUM": "USA", "VIR": "USA", "CUW": "NLD", "ABW": "NLD", "ESH": "MAR",
            "CHI": "GBR", "IMN": "GBR"}
# Places the World Bank has no row for.
WB_EXTRA = {"TWN": ("EAS", "HIC"), "ESH": ("MEA", "LMC"), "GUF": ("LCN", "HIC"),
            "GLP": ("LCN", "HIC"), "MTQ": ("LCN", "HIC"), "REU": ("SSF", "HIC"),
            "MYT": ("SSF", "UMC")}

# World Bank indicators carried into the game, in this order (values in "w").
WDI_KEEP = [
    "NY.GDP.PCAP.PP.KD", "NY.GDP.PCAP.CD", "NY.GDP.PCAP.CN", "FP.CPI.TOTL.ZG", "SI.POV.GINI",
    "SI.POV.DDAY", "SI.POV.LMIC", "SI.POV.UMIC",
    "SL.TLF.CACT.MA.ZS", "SL.TLF.CACT.FE.ZS", "SL.UEM.TOTL.ZS", "SL.UEM.1524.ZS", "SL.UEM.NEET.ZS",
    "SL.AGR.EMPL.MA.ZS", "SL.AGR.EMPL.FE.ZS", "SL.IND.EMPL.MA.ZS", "SL.IND.EMPL.FE.ZS",
    "SL.SRV.EMPL.MA.ZS", "SL.SRV.EMPL.FE.ZS", "SL.EMP.SELF.ZS", "SL.EMP.VULN.ZS", "SL.EMP.MPYR.ZS",
    "SL.TLF.0714.ZS", "SL.ISV.IFRM.ZS",
    "SE.PRM.CMPT.ZS", "SE.SEC.CMPT.LO.ZS", "SE.SEC.NENR", "SE.SEC.ENRR", "SE.SEC.UNER.LO.MA.ZS",
    "SE.SEC.UNER.LO.FE.ZS", "SE.TER.ENRR.MA", "SE.TER.ENRR.FE", "SE.ADT.LITR.ZS", "SE.ADT.1524.LT.ZS",
    "SE.TER.CUAT.BA.ZS", "SE.SEC.CUAT.UP.ZS", "SE.PRM.CUAT.ZS", "SE.LPV.PRIM", "HD.HCI.OVRL",
    "SH.STA.STNT.ZS", "SH.DYN.AIDS.ZS", "SH.TBS.INCD", "SH.MLR.INCD.P3", "SH.PRV.SMOK.MA",
    "SH.PRV.SMOK.FE", "SH.ALC.PCAP.LI", "SH.UHC.SRVS.CV.XD", "SH.XPD.OOPC.CH.ZS", "SH.UHC.OOPC.10.ZS",
    "SH.MED.PHYS.ZS", "SH.STA.MMRT", "SH.H2O.BASW.ZS", "SH.STA.BASS.ZS", "EG.ELC.ACCS.ZS",
    "EG.CFT.ACCS.ZS",
    "SP.URB.TOTL.IN.ZS", "SP.M18.2024.FE.ZS", "SP.M15.2024.FE.ZS", "SP.ADO.TFRT", "SP.DYN.CONU.ZS",
    "SH.FPL.SATM.ZS", "SG.VAW.1549.ZS", "IT.NET.USER.ZS", "IT.CEL.SETS.P2", "SM.POP.REFG.OR",
    "VC.BTL.DETH", "SM.POP.TOTL.ZS", "BX.TRF.PWKR.DT.GD.ZS", "ST.INT.DPRT", "SP.POP.65UP.TO.ZS",
    "FX.OWN.TOTL.ZS", "FR.INR.LEND", "FR.INR.DPST", "CM.MKT.LCAP.GD.ZS",
]
# Count-type indicators get no region-median fill (a missing value means none/unknown).
WDI_NOFILL = {"SM.POP.REFG.OR", "VC.BTL.DETH", "ST.INT.DPRT", "CM.MKT.LCAP.GD.ZS"}
# Indicators that come from household surveys run mostly in low- and middle-income countries.
# A high-income country without a value is not like its region's median (which would give, say,
# Korea a 15% child-marriage rate); it gets these near-zero defaults instead.
HIC_DEFAULT = {"SL.TLF.0714.ZS": 1, "SL.ISV.IFRM.ZS": 12, "SE.SEC.UNER.LO.MA.ZS": 2,
               "SE.SEC.UNER.LO.FE.ZS": 2, "SE.LPV.PRIM": 8, "SH.STA.STNT.ZS": 2.5,
               "SP.M18.2024.FE.ZS": 2, "SP.M15.2024.FE.ZS": 0.2, "SH.MLR.INCD.P3": 0,
               "SG.VAW.1549.ZS": 5, "SH.FPL.SATM.ZS": 75, "SH.UHC.OOPC.10.ZS": 6}
# No World Bank GDP series. Rough anchors from national statistics / IMF estimates:
# gk = GDP per capita, constant 2021 PPP $; gl = GDP per capita in local currency for YEAR
# (usd=1: in US dollars because the local currency has no usable series).
MANUAL_MONEY = {
    "TWN": {"gk": 66000, "gl": 1130000, "earn0": 0.62},  # DGBAS: GDP pc 2024 ~NT$1.05M, earnings ~NT$700k/yr
    "PRK": {"gk": 1700, "gl": 1300, "usd": 1},     # Bank of Korea estimate ~US$1,250
    "VEN": {"gk": 7500, "gl": 3800, "usd": 1},
    "CUB": {"gk": 9000, "gl": 6000, "usd": 1},
    "YEM": {"gk": 2000, "gl": 550, "usd": 1},
    "SSD": {"gk": 1200, "gl": 400, "usd": 1},
    "ERI": {"gk": 1800, "gl": 650, "usd": 1},
    "GUF": {"gk": 27000, "gl": 17500},             # INSEE: ~EUR 17k
    "REU": {"gk": 37000, "gl": 24500},             # INSEE: ~EUR 24k
    "MYT": {"gk": 17000, "gl": 11000},             # INSEE: ~EUR 11k
    "ESH": {"same": "MAR"},
}
# Shown in US dollars: the local currency collapsed or re-denominated, so a 2026 price level
# projected from the latest local-currency GDP would mislead.
USD_DISPLAY = {"ZWE", "LBN", "SYR", "SDN", "SSD", "YEM", "VEN", "CUB", "PRK", "ERI"}

POV_LINES = [("SI.POV.DDAY", 3.00), ("SI.POV.LMIC", 4.20), ("SI.POV.UMIC", 8.30)]  # 2021 PPP $/day

DIST = ["SI.DST.FRST.10", "SI.DST.FRST.20", "SI.DST.02ND.20", "SI.DST.03RD.20", "SI.DST.04TH.20",
        "SI.DST.05TH.20", "SI.DST.10TH.10"]


def sig(x, n=3):
    if x is None:
        return None
    if x == 0:
        return 0
    d = n - 1 - int(math.floor(math.log10(abs(x))))
    v = round(x, d)
    return int(v) if v == int(v) and abs(v) >= 1 else v


def rows(path, keep):
    with gzip.open(path, "rt", encoding="utf-8-sig") as f:
        for r in csv.DictReader(f):
            if r["LocTypeName"] == "Country/Area" and keep(r):
                yield r


def load_wpp(raw):
    c = {}
    for r in rows(os.path.join(raw, "pop1.csv.gz"), lambda r: r["Time"] == str(YEAR) and r["AgeGrp"] == "14"):
        c[r["ISO3_code"]] = {"n": r["Location"], "p": [round(float(r["PopMale"]), 1), round(float(r["PopFemale"]), 1)]}
    c = {k: v for k, v in c.items() if sum(v["p"]) >= MIN_P14}
    print("countries", len(c))

    years = {str(y) for y in LT_YEARS}
    for r in rows(os.path.join(raw, "lt.csv.gz"), lambda r: r["Time"] in years and r["Sex"] in ("Male", "Female")):
        iso = r["ISO3_code"]
        if iso not in c or int(r["AgeGrpStart"]) < 10:
            continue
        s = "m" if r["Sex"] == "Male" else "f"
        lt = c[iso].setdefault("lt", {"m": [[0] * len(LT_AGES) for _ in LT_YEARS], "f": [[0] * len(LT_AGES) for _ in LT_YEARS]})
        yi = LT_YEARS.index(int(r["Time"]))
        ai = LT_AGES.index(int(r["AgeGrpStart"]))
        lt[s][yi][ai] = max(1, round(float(r["mx"]) * 1e5))  # central death rate per 100k

    for r in rows(os.path.join(raw, "demo.csv.gz"), lambda r: r["Time"] in (str(YEAR), "2050")):
        iso = r["ISO3_code"]
        if iso not in c:
            continue
        f = lambda k: float(r[k]) if r[k] else None
        if r["Time"] == str(YEAR):
            c[iso].update({
                "e0": [sig(f("LExMale"), 3), sig(f("LExFemale"), 3)],
                "e15": [sig(f("LE15Male"), 3), sig(f("LE15Female"), 3)],
                "tfr": [sig(f("TFR"), 3)], "mac": sig(f("MAC"), 3), "mig": sig(f("CNMR"), 2),
                "pop": round(f("TPopulation1July")), "age": sig(f("MedianAgePop"), 3),
                "q5": sig(f("Q5"), 3),  # under-5 deaths per 1000 births (for the player's own children)
            })
        else:
            c[iso]["tfr2050"] = sig(f("TFR"), 3)
    for iso in c:
        c[iso]["tfr"].append(c[iso].pop("tfr2050"))

    years = {str(y) for y in ASFR_YEARS}
    for r in rows(os.path.join(raw, "fert5.csv.gz"), lambda r: r["Time"] in years and r["AgeGrp"] in ASFR_AGES):
        iso = r["ISO3_code"]
        if iso not in c:
            continue
        a = c[iso].setdefault("asfr", [[0] * 7 for _ in ASFR_YEARS])
        a[ASFR_YEARS.index(int(r["Time"]))][ASFR_AGES.index(r["AgeGrp"])] = sig(float(r["ASFR"]), 3)
    return c


def load_ghe(raw):
    wb = openpyxl.load_workbook(os.path.join(raw, "ghe2023.xlsx"), read_only=True)
    out = {}  # iso -> {"m": [[permille]*causes] per age sheet, "f": ...}
    for si, sheet in enumerate(CD_SHEETS):
        ws = wb[sheet]
        ws.reset_dimensions()  # the file's stored dimensions say 1x1
        it = ws.iter_rows(values_only=True)
        isos = None
        table = {"Males": {}, "Females": {}}
        for i, row in enumerate(it):
            if i == 7:
                isos = list(row)
            if row[0] in table and isinstance(row[1], (int, float)):
                table[row[0]][int(row[1])] = row
        for col in range(7, len(isos)):
            iso = isos[col]
            if not isinstance(iso, str) or len(iso) != 3:
                continue
            for sex, key in (("Males", "m"), ("Females", "f")):
                t = table[sex]
                val = lambda code: float(t[code][col] or 0) if code in t else 0.0
                total = val(0)
                shares = []
                for _, plus, minus in CAUSES:
                    v = sum(val(k) for k in plus) - sum(val(k) for k in minus)
                    shares.append(max(0.0, v))
                shares.append(max(0.0, total - sum(shares)))
                tot = sum(shares) or 1
                pm = [round(x / tot * 1000) for x in shares]
                d = out.setdefault(iso, {"m": [None] * len(CD_SHEETS), "f": [None] * len(CD_SHEETS)})
                d[key][si] = pm
    return out


def wb_meta(raw):
    data = json.load(open(os.path.join(raw, "wb_countries.json")))[1]
    meta = {}
    for d in data:
        if d["region"]["id"] == "NA":
            continue
        meta[d["id"]] = (d["region"]["id"], d["incomeLevel"]["id"])
    meta.update(WB_EXTRA)
    return meta


def load_ilo(raw, c, wdi):
    # modelled employment by occupation (ISCO-08 1..8 and merged 6+9) by sex, latest year <= YEAR
    occ = {}
    with open(os.path.join(raw, "ilo_occ.csv")) as f:
        for r in csv.DictReader(f):
            y = int(r["TIME_PERIOD"])
            if y > YEAR:
                continue
            k = (r["REF_AREA"], r["SEX"])
            occ.setdefault(k, {}).setdefault(y, {})[r["OCU"].replace("OCU_ISCO08_", "")] = float(r["OBS_VALUE"])
    # survey counts, used to split 6 vs 9
    obs = {}
    with open(os.path.join(raw, "ilo_occ_obs.csv")) as f:
        for r in csv.DictReader(f):
            if not r["OCU"].startswith("OCU_ISCO08_"):
                continue
            k = (r["REF_AREA"], r["SEX"])
            obs.setdefault(k, {}).setdefault(int(r["TIME_PERIOD"]), {})[r["OCU"].replace("OCU_ISCO08_", "")] = float(r["OBS_VALUE"] or 0)
    split6 = {}
    for k, years in obs.items():
        y = max(years)
        v = years[y]
        if v.get("6", 0) + v.get("9", 0) > 0:
            split6[k] = v.get("6", 0) / (v.get("6", 0) + v.get("9", 0))
    for iso in c:
        res = {}
        for sex, key in (("SEX_M", "m"), ("SEX_F", "f")):
            years = occ.get((iso, sex))
            if not years:
                continue
            v = years[max(years)]
            tot = v.get("TOTAL") or sum(x for k2, x in v.items() if k2 != "TOTAL")
            if not tot:
                continue
            s6 = split6.get((iso, sex))
            if s6 is None:
                agr = (wdi.get("SL.AGR.EMPL.MA.ZS" if key == "m" else "SL.AGR.EMPL.FE.ZS", {}).get(iso) or [None])[0]
                m96 = v.get("96", 0) / tot * 100
                s6 = min(0.9, max(0.1, (agr or m96 * 0.5) * 0.8 / m96)) if m96 else 0.5
            g = [v.get(str(i), 0) for i in range(1, 10)]
            g[5] = v.get("96", 0) * s6
            g[8] = v.get("96", 0) * (1 - s6)
            res[key] = [round(x / tot * 1000) for x in g]
        if res:
            c[iso]["occ"] = res

    # earnings: mean monthly earnings of employees, PPP$, by ISCO major group; latest year per country
    earn = {}
    with open(os.path.join(raw, "ilo_earn.csv")) as f:
        for r in csv.DictReader(f):
            if not r["OBS_VALUE"]:
                continue
            code = r["OCU"]
            for pre in ("OCU_ISCO08_", "OCU_ISCO88_"):
                if code.startswith(pre):
                    earn.setdefault(r["REF_AREA"], {}).setdefault((int(r["TIME_PERIOD"]), pre), {})[code[len(pre):]] = float(r["OBS_VALUE"])
    return earn


def main():
    raw, out = sys.argv[1], sys.argv[2]
    c = load_wpp(raw)
    ghe = load_ghe(raw)
    meta = wb_meta(raw)
    wdi = json.load(open(os.path.join(raw, "wdi.json")))
    ser = json.load(open(os.path.join(raw, "wdi_series.json")))

    for iso, d in c.items():
        r, inc = meta.get(iso, (None, None))
        d["r"], d["i"] = r, inc
        src = iso if iso in ghe else CD_PROXY.get(iso)
        if src in ghe:
            d["cd"] = ghe[src]
            if src != iso:
                d["cdp"] = src
    missing = [k for k, d in c.items() if "cd" not in d or not d["r"]]
    if missing:
        print("dropping (no cause data or region):", missing)
        for k in missing:
            del c[k]

    # World Bank values, with region(+income) median fill for missing ones
    def groups(iso):
        d = c[iso]
        return [(d["r"], d["i"]), (None, d["i"]), (d["r"], None), (None, None)]

    for iso, d in c.items():
        d["w"], d["wi"] = [], []
    for j, code in enumerate(WDI_KEEP):
        vals = {iso: wdi.get(code, {}).get(iso, [None])[0] for iso in c}
        pools = {}
        for iso, v in vals.items():
            if v is None:
                continue
            for g in groups(iso):
                pools.setdefault(g, []).append(v)
        for iso, d in c.items():
            v = vals[iso]
            if v is None and code in HIC_DEFAULT and d["i"] == "HIC":
                v = HIC_DEFAULT[code]
                d["wi"].append(j)
            elif v is None and code not in WDI_NOFILL:
                for g in groups(iso):
                    if len(pools.get(g, [])) >= 3:
                        v = statistics.median(pools[g])
                        break
                d["wi"].append(j)
            d["w"].append(sig(v, 3))

    # income distribution: decile shares (permille) and survey mean (2021 PPP $/day)
    gdp_kd = ser["NY.GDP.PCAP.PP.KD"]
    ratio_pool = {}
    dist = {}
    for iso in c:
        vals = [wdi.get(code, {}).get(iso) for code in DIST]
        if all(vals):
            d1, q1, q2, q3, q4, q5, d10 = [v[0] for v in vals]
            dec = [d1, q1 - d1, q2 * 0.46, q2 * 0.54, q3 * 0.47, q3 * 0.53, q4 * 0.46, q4 * 0.54, q5 - d10, d10]
            dist[iso] = [round(x * 10) for x in dec]
        sp = wdi.get("SI.SPR.PCAP", {}).get(iso)
        if sp:
            g = gdp_kd.get(iso, {}).get(str(sp[1]))
            if g:
                c[iso]["sr"] = sp[0] * 365 / g  # survey mean / GDP pc, same year
                ratio_pool.setdefault(c[iso]["i"], []).append(c[iso]["sr"])
    from statistics import NormalDist
    nd = NormalDist()
    for iso, d in c.items():
        if "sr" in d:
            continue
        gini = (wdi.get("SI.POV.GINI", {}).get(iso) or [None, None])
        mus = []
        for code, line in POV_LINES:
            h = wdi.get(code, {}).get(iso)
            if not h or not gini[0] or not (1 <= h[0] <= 99):
                continue
            sigma = math.sqrt(2) * nd.inv_cdf((gini[0] / 100 + 1) / 2)
            mu = math.log(line) - sigma * nd.inv_cdf(h[0] / 100)
            g = gdp_kd.get(iso, {}).get(str(h[1]))
            if g:
                mus.append(math.exp(mu + sigma * sigma / 2) * 365 / g)
        if mus:
            d["sr"] = statistics.median(mus)
            print("survey mean from poverty lines", iso, round(d["sr"], 3))
    for iso, d in c.items():
        if iso in dist:
            d["dec"] = dist[iso]
        else:
            pool = [dist[k] for k in dist if c[k]["r"] == d["r"]] or list(dist.values())
            d["dec"] = [round(statistics.median(p[i] for p in pool)) for i in range(10)]
            d["wi"].append("dec")
        if "sr" not in d:
            d["sr"] = statistics.median(ratio_pool.get(d["i"]) or sum(ratio_pool.values(), []))
            d["wi"].append("sr")
        d["sr"] = sig(min(1.0, max(0.15, d["sr"])), 3)

    # money anchors: GDP pc (2021 PPP$) and current-LCU GDP pc projected to YEAR with latest inflation
    for iso, d in c.items():
        kd = wdi.get("NY.GDP.PCAP.PP.KD", {}).get(iso)
        cn = wdi.get("NY.GDP.PCAP.CN", {}).get(iso)
        infl = (wdi.get("FP.CPI.TOTL.ZG", {}).get(iso) or [3.0])[0]
        infl = max(-2.0, min(infl, 30.0)) / 100
        if kd:
            d["gk"] = sig(kd[0], 4)
        if iso in USD_DISPLAY:
            cn = wdi.get("NY.GDP.PCAP.CD", {}).get(iso)
            infl = 0.025
            d["usd"] = 1
        if cn:
            d["gl"] = sig(cn[0] * (1 + infl) ** (YEAR - cn[1]), 4)
    for iso, m in MANUAL_MONEY.items():
        if iso not in c:
            continue
        if "same" in m:
            for k in ("gk", "gl", "usd"):
                if k in c[m["same"]]:
                    c[iso][k] = c[m["same"]][k]
        else:
            c[iso].update({k: v for k, v in m.items() if k != "earn0"})
        c[iso]["wi"].append("gk")
    # fill money anchors from region medians of the LCU/PPP ratio is meaningless across currencies;
    # countries without them get gl = gk (shown as international dollars)
    for iso, d in c.items():
        if "gk" not in d:
            peers = ([x["gk"] for x in c.values() if "gk" in x and x["r"] == d["r"] and x["i"] == d["i"]]
                     or [x["gk"] for x in c.values() if "gk" in x and x["i"] == d["i"]])
            d["gk"] = sig(statistics.median(peers), 4)
            print("gk imputed", iso)
            d["wi"].append("gk")
        if "gl" not in d:
            d["gl"] = d["gk"]
            d["usd"] = 1

    # earnings by occupation relative to GDP per capita (same year)
    earn = load_ilo(raw, c, wdi)
    gdp_cd = ser["NY.GDP.PCAP.PP.CD"]
    ratios = {}
    for iso, d in c.items():
        e = earn.get(iso)
        if not e:
            continue
        best = None
        for (y, pre), v in sorted(e.items(), key=lambda kv: (kv[0][0], kv[0][1] == "OCU_ISCO08_")):
            if "TOTAL" in v and str(y) in gdp_cd.get(iso, {}) and sum(1 for i in range(1, 10) if str(i) in v) >= 7:
                best = (y, v)
        if not best:
            continue
        y, v = best
        g = gdp_cd[iso][str(y)]
        tot = v["TOTAL"]
        rel = [v.get(str(i), None) for i in range(1, 10)]
        d["earn"] = [sig(tot * 12 / g, 3)] + [sig(x / tot, 3) if x else None for x in rel]
        ratios.setdefault(d["i"], []).append(d["earn"])
    for iso, d in c.items():
        pool = ratios.get(d["i"]) or sum(ratios.values(), [])
        if "earn" not in d:
            d["earn"] = [sig(statistics.median(p[k] for p in pool if p[k]), 3) for k in range(10)]
            d["wi"].append("earn")
        else:
            for k in range(1, 10):
                if d["earn"][k] is None:
                    d["earn"][k] = sig(statistics.median(p[k] for p in pool if p[k]), 3)
        if "occ" not in d:
            peers = [x["occ"] for x in c.values() if "occ" in x and x["r"] == d["r"]]
            d["occ"] = {s: [round(statistics.median(p[s][i] for p in peers)) for i in range(9)] for s in "mf"}
            d["wi"].append("occ")

    for iso, m in MANUAL_MONEY.items():
        if iso in c and "earn0" in m:
            c[iso]["earn"][0] = m["earn0"]

    # global income distribution of 14-year-olds' households: percentiles of per-capita PPP$/day
    pts = []
    for iso, d in c.items():
        mean_day = d["sr"] * d["gk"] / 365
        for k, share in enumerate(d["dec"]):
            pts.append((mean_day * share / 100, d["pop"] / 10))
    pts.sort()
    total = sum(w for _, w in pts)
    pct, acc, j = [], 0.0, 0
    for p in range(1, 100):
        target = total * p / 100
        while acc + pts[j][1] < target:
            acc += pts[j][1]
            j += 1
        pct.append(sig(pts[j][0], 3))

    data = {
        "v": 1, "year": YEAR, "ltYears": LT_YEARS, "ltAges": LT_AGES, "asfrYears": ASFR_YEARS,
        "cdAges": CD_SHEETS, "causes": CAUSE_KEYS, "wdi": WDI_KEEP, "worldPct": pct,
        "p14": round(sum(sum(d["p"]) for d in c.values())), "c": c,
    }
    js = "window.LIFE_DATA=" + json.dumps(data, separators=(",", ":"), ensure_ascii=False) + ";\n"
    open(out, "w").write("// Generated by life/tools/build_data.py from UN WPP 2024, WHO GHE 2023, World Bank WDI, ILOSTAT. Do not edit.\n" + js)
    print("wrote", out, len(js) // 1024, "KB", len(c), "countries")


if __name__ == "__main__":
    main()
