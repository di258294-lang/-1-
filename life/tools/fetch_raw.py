#!/usr/bin/env python3
"""Download the raw public datasets the game is built from.

Usage: python3 life/tools/fetch_raw.py <raw_dir>

Everything lands in <raw_dir> (keep it outside the repo; the files are large).
build_data.py then turns them into life/src/data.js.

Sources
- UN World Population Prospects 2024 (medium variant): single-age population,
  abridged life tables 2024-2100, fertility by age, demographic indicators.
- WHO Global Health Estimates 2023: deaths by cause, age group, sex, country.
- World Bank World Development Indicators (API, most recent value per country).
- ILOSTAT: modelled employment by sex and occupation (ISCO-08), mean monthly
  earnings of employees by occupation (PPP $).
"""
import json
import os
import subprocess
import sys
import urllib.request

WPP = "https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/"
WPP_FILES = {
    "pop1.csv.gz": WPP + "WPP2024_PopulationBySingleAgeSex_Medium_2024-2100.csv.gz",
    "lt.csv.gz": WPP + "WPP2024_Life_Table_Abridged_Medium_2024-2100.csv.gz",
    "demo.csv.gz": WPP + "WPP2024_Demographic_Indicators_Medium.csv.gz",
    "fert5.csv.gz": WPP + "WPP2024_Fertility_by_Age5.csv.gz",
}
GHE = ("https://cdn.who.int/media/docs/default-source/gho-documents/global-health-estimates/"
       "deaths_bycountry_age_sex_2023_2026-10-01e7663d9c-6384-479a-bb37-b58b127e7288.xlsx?sfvrsn=3ede9d95_2")

# World Bank indicator codes (most recent non-empty value per country).
WDI = [
    # income, prices
    "NY.GDP.PCAP.PP.KD", "NY.GDP.PCAP.CD", "NY.GDP.PCAP.CN", "NY.GNP.PCAP.CD", "PA.NUS.PPP", "PA.NUS.PRVT.PP",
    "PA.NUS.FCRF", "FP.CPI.TOTL.ZG", "NE.CON.PRVT.PC.KD",
    "SI.POV.GINI", "SI.DST.FRST.10", "SI.DST.FRST.20", "SI.DST.02ND.20", "SI.DST.03RD.20",
    "SI.DST.04TH.20", "SI.DST.05TH.20", "SI.DST.10TH.10", "SI.POV.DDAY", "SI.POV.LMIC",
    "SI.POV.UMIC", "SI.SPR.PCAP",
    # labour
    "SL.TLF.CACT.MA.ZS", "SL.TLF.CACT.FE.ZS", "SL.UEM.TOTL.ZS", "SL.UEM.1524.ZS", "SL.UEM.NEET.ZS",
    "SL.AGR.EMPL.MA.ZS", "SL.AGR.EMPL.FE.ZS", "SL.IND.EMPL.MA.ZS", "SL.IND.EMPL.FE.ZS",
    "SL.SRV.EMPL.MA.ZS", "SL.SRV.EMPL.FE.ZS", "SL.EMP.SELF.ZS", "SL.EMP.VULN.ZS", "SL.EMP.MPYR.ZS",
    "SL.TLF.0714.ZS", "SL.ISV.IFRM.ZS",
    # education
    "SE.PRM.CMPT.ZS", "SE.SEC.CMPT.LO.ZS", "SE.SEC.NENR", "SE.SEC.ENRR", "SE.SEC.UNER.LO.ZS",
    "SE.SEC.UNER.LO.MA.ZS", "SE.SEC.UNER.LO.FE.ZS", "SE.TER.ENRR", "SE.TER.ENRR.MA", "SE.TER.ENRR.FE",
    "SE.ADT.LITR.ZS", "SE.ADT.1524.LT.ZS", "SE.TER.CUAT.BA.ZS", "SE.SEC.CUAT.UP.ZS", "SE.PRM.CUAT.ZS",
    "SE.LPV.PRIM", "HD.HCI.OVRL",
    # health
    "SH.STA.STNT.ZS", "SH.DYN.AIDS.ZS", "SH.TBS.INCD", "SH.MLR.INCD.P3", "SH.PRV.SMOK.MA",
    "SH.PRV.SMOK.FE", "SH.ALC.PCAP.LI", "SH.UHC.SRVS.CV.XD", "SH.XPD.OOPC.CH.ZS", "SH.UHC.OOPC.10.ZS",
    "SH.MED.PHYS.ZS", "SH.STA.MMRT", "SH.H2O.BASW.ZS", "SH.STA.BASS.ZS", "EG.ELC.ACCS.ZS",
    "EG.CFT.ACCS.ZS",
    # society, family
    "SP.URB.TOTL.IN.ZS", "SP.M18.2024.FE.ZS", "SP.M15.2024.FE.ZS", "SP.ADO.TFRT", "SP.DYN.CONU.ZS",
    "SH.FPL.SATM.ZS", "SG.VAW.1549.ZS", "IT.NET.USER.ZS", "IT.CEL.SETS.P2", "SM.POP.REFG.OR",
    "VC.BTL.DETH", "SM.POP.TOTL.ZS", "SM.POP.NETM", "BX.TRF.PWKR.DT.GD.ZS", "ST.INT.DPRT",
    "SP.POP.65UP.TO.ZS", "SP.POP.TOTL",
    # money
    "FX.OWN.TOTL.ZS", "FR.INR.LEND", "FR.INR.DPST", "CM.MKT.LCAP.GD.ZS",
]

# Year-by-year series, to relate a survey or earnings value to GDP of the same year.
WDI_SERIES = ["NY.GDP.PCAP.PP.CD", "NY.GDP.PCAP.PP.KD"]

ILO = "https://sdmx.ilo.org/rest/data/ILO,{flow},1.0/{key}?startPeriod={start}"
ILO_QUERIES = {
    "ilo_occ.csv": ("DF_EMP_2EMP_SEX_OCU_NB", ".A..SEX_M+SEX_F.", 2024),
    "ilo_earn.csv": ("DF_EAR_EMTA_SEX_OCU_CUR_NB", ".A..SEX_T..CUR_TYPE_PPP", 2012),
    # survey (not modelled) counts: the modelled series merges ISCO 6 and 9
    "ilo_occ_obs.csv": ("DF_EMP_TEMP_SEX_OCU_NB", ".A..SEX_M+SEX_F.", 2012),
}


def curl(url, out, accept=None):
    cmd = ["curl", "-sSL", "--fail", "-m", "1200", "-o", out, url]
    if accept:
        cmd[1:1] = ["-H", "Accept: " + accept]
    subprocess.run(cmd, check=True)


def main():
    raw = sys.argv[1]
    os.makedirs(raw, exist_ok=True)
    for name, url in WPP_FILES.items():
        path = os.path.join(raw, name)
        if not os.path.exists(path):
            print("WPP", name)
            curl(url, path)
    path = os.path.join(raw, "ghe2023.xlsx")
    if not os.path.exists(path):
        print("WHO GHE 2023")
        curl(GHE, path)
    for name, (flow, key, start) in ILO_QUERIES.items():
        path = os.path.join(raw, name)
        if not os.path.exists(path):
            print("ILO", flow)
            curl(ILO.format(flow=flow, key=key, start=start), path,
                 accept="application/vnd.sdmx.data+csv;version=1.0.0")
    path = os.path.join(raw, "wb_countries.json")
    if not os.path.exists(path):
        curl("https://api.worldbank.org/v2/country?format=json&per_page=400", path)
    wdi_path = os.path.join(raw, "wdi.json")
    wdi = json.load(open(wdi_path)) if os.path.exists(wdi_path) else {}
    for code in WDI:
        if code in wdi:
            continue
        url = f"https://api.worldbank.org/v2/country/all/indicator/{code}?format=json&mrnev=1&per_page=1000"
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = json.load(r)
        except Exception as e:  # keep going; a missing indicator falls back to region medians
            print("WDI fail", code, e)
            continue
        rows = data[1] if len(data) > 1 and data[1] else []
        wdi[code] = {row["countryiso3code"]: [row["value"], int(row["date"])]
                     for row in rows if row["countryiso3code"] and row["value"] is not None}
        print("WDI", code, len(wdi[code]))
        json.dump(wdi, open(wdi_path, "w"))
    ser_path = os.path.join(raw, "wdi_series.json")
    ser = json.load(open(ser_path)) if os.path.exists(ser_path) else {}
    for code in WDI_SERIES:
        if code in ser:
            continue
        url = f"https://api.worldbank.org/v2/country/all/indicator/{code}?format=json&date=2005:2025&per_page=20000"
        with urllib.request.urlopen(url, timeout=300) as r:
            data = json.load(r)
        out = {}
        for row in data[1] or []:
            if row["countryiso3code"] and row["value"] is not None:
                out.setdefault(row["countryiso3code"], {})[row["date"]] = row["value"]
        ser[code] = out
        print("WDI series", code, len(out))
        json.dump(ser, open(ser_path, "w"))


if __name__ == "__main__":
    main()
