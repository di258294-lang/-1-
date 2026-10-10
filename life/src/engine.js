// Core simulation. No DOM here: the same code runs in the page and in tools/sim.mjs.
// Probabilities come from window.LIFE_DATA (UN WPP 2024, WHO GHE 2023, World Bank, ILOSTAT).
(function (G) {
  const D = G.LIFE_DATA, C = G.LIFE_CURATED;
  const E = {};
  const WIDX = {};
  D.wdi.forEach((k, i) => (WIDX[k] = i));

  // ---------- random numbers (seeded, serializable) ----------
  function rnd(s) {
    // mulberry32 on s.rng
    let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const R = {
    f: rnd,
    chance: (s, p) => rnd(s) < p,
    int: (s, a, b) => a + Math.floor(rnd(s) * (b - a + 1)),
    pick: (s, arr) => arr[Math.floor(rnd(s) * arr.length)],
    normal: (s, m = 0, sd = 1) => {
      const u = Math.max(1e-12, rnd(s)), v = rnd(s);
      return m + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    weighted: (s, items, wfn) => {
      const ws = items.map(wfn);
      const tot = ws.reduce((a, b) => a + Math.max(0, b), 0);
      if (tot <= 0) return items[0];
      let x = rnd(s) * tot;
      for (let i = 0; i < items.length; i++) {
        x -= Math.max(0, ws[i]);
        if (x <= 0) return items[i];
      }
      return items[items.length - 1];
    },
  };
  E.R = R;

  // ---------- math helpers ----------
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const logit = (p) => Math.log(clamp(p, 1e-6, 1 - 1e-6) / (1 - clamp(p, 1e-6, 1 - 1e-6)));
  const inv = (x) => 1 / (1 + Math.exp(-x));
  // shift a base rate up or down for one person: z>0 raises it (odds scale)
  const shift = (p, z) => inv(logit(p) + z);
  function normInv(p) {
    // Acklam's approximation
    p = clamp(p, 1e-9, 1 - 1e-9);
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
    const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
    const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
    const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742];
    const q = p < 0.02425 ? Math.sqrt(-2 * Math.log(p)) : p > 1 - 0.02425 ? Math.sqrt(-2 * Math.log(1 - p)) : 0;
    if (p < 0.02425) return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    if (p > 1 - 0.02425) return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
    const r = p - 0.5, t = r * r;
    return (((((a[0] * t + a[1]) * t + a[2]) * t + a[3]) * t + a[4]) * t + a[5]) * r / (((((b[0] * t + b[1]) * t + b[2]) * t + b[3]) * t + b[4]) * t + 1);
  }
  function normCdf(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }
  E.M = { clamp, logit, inv, shift, normInv, normCdf };

  // ---------- data access ----------
  E.D = D;
  E.C = C;
  const W = (iso, code) => {
    const c = D.c[iso];
    const v = c && c.w[WIDX[code]];
    return v == null ? null : v;
  };
  const Wp = (iso, code, dflt = 0) => {
    const v = W(iso, code);
    return v == null ? dflt : v / 100;
  };
  E.W = W;
  E.Wp = Wp;
  E.imputed = (iso, code) => {
    const c = D.c[iso];
    return !!c && (c.wi.includes(WIDX[code]) || c.wi.includes(code));
  };

  function profile(iso) {
    const d = D.c[iso];
    const reg = C.regions[d.r] || C.regions.ECS;
    const det = C.detail[iso] || {};
    const p = Object.assign({}, reg, det);
    p.sch = Object.assign({ low: "중학교", up: "고등학교", voc: "직업학교", uni: "대학" }, det.sch || {});
    p.iso = iso;
    p.ko = (C.countries[iso] || [d.n])[0];
    p.cur = d.usd ? "USD" : (C.countries[iso] || [0, "USD"])[1];
    p.d = d;
    p.eastName = ["CHN", "TWN", "JPN", "KOR", "PRK", "VNM", "HKG", "MAC"].includes(iso);
    return p;
  }
  const PROF = {};
  E.prof = (iso) => PROF[iso] || (PROF[iso] = profile(iso));

  // central death rate (per person-year) at a fractional age and calendar year, log-interpolated
  function mx(iso, sex, age, year) {
    const lt = D.c[iso].lt[sex];
    const ys = D.ltYears, as = D.ltAges;
    const yy = clamp(year, ys[0], ys[ys.length - 1]);
    let yi = 0;
    while (yi < ys.length - 2 && yy > ys[yi + 1]) yi++;
    const yt = (yy - ys[yi]) / (ys[yi + 1] - ys[yi]);
    const at = (row) => {
      const mid = (i) => as[i] + 2.5;
      if (age <= mid(0)) return Math.log(row[0]);
      if (age >= mid(as.length - 1)) return Math.log(row[as.length - 1]);
      let i = 0;
      while (age > mid(i + 1)) i++;
      const t = (age - mid(i)) / 5;
      return Math.log(row[i]) * (1 - t) + Math.log(row[i + 1]) * t;
    };
    const lm = at(lt[yi]) * (1 - yt) + at(lt[yi + 1]) * yt;
    return Math.exp(lm) / 1e5;
  }
  E.mx = mx;
  E.annualQ = (iso, sex, age, year) => 1 - Math.exp(-mx(iso, sex, age, year));
  // probability of surviving from age a to age b (both fractional), starting in calendar year y
  E.survival = (iso, sex, a, b, y) => {
    let s = 1;
    for (let t = a; t < b; t += 1) s *= Math.exp(-mx(iso, sex, t + 0.5, y + (t - a)) * Math.min(1, b - t));
    return s;
  };

  const CD_EDGES = [5, 15, 30, 50, 60, 70];
  function causeShares(iso, sex, age) {
    let i = 0;
    while (i < CD_EDGES.length - 1 && age >= CD_EDGES[i + 1]) i++;
    return D.c[iso].cd[sex][i];
  }
  E.causeShares = causeShares;
  E.causeIndex = {};
  D.causes.forEach((k, i) => (E.causeIndex[k] = i));
  const INFECT = ["tb", "hiv", "diarrhea", "malaria", "infect", "resp_inf", "nutrition"];
  const INJURY = ["road", "drowning", "falls", "fire", "poison", "disaster", "injury_other", "homicide", "war"];

  // income per person per day (2021 PPP $) at national percentile u
  function incomeAt(iso, u) {
    const d = D.c[iso];
    const mean = (d.sr * d.gk) / 365;
    const dec = d.dec.map((x) => (x / 100) * mean); // decile means
    u = clamp(u, 0.001, 0.999);
    if (u >= 0.9) {
      // Pareto tail matched to the top-decile mean
      const xm = Math.max(dec[8] * 1.2, dec[9] * 0.55);
      const a = Math.max(1.3, dec[9] / Math.max(1e-6, dec[9] - xm));
      return xm * Math.pow(0.1 / (1 - u), 1 / a);
    }
    const pos = u * 10 - 0.5;
    if (pos <= 0) return dec[0] * Math.pow((u * 10) / 0.5, 0.6) * 0.9 + dec[0] * 0.1;
    const i = Math.floor(pos), t = pos - i;
    return Math.exp(Math.log(dec[i]) * (1 - t) + Math.log(dec[Math.min(9, i + 1)]) * t);
  }
  E.incomeAt = incomeAt;
  E.worldPct = (pppDay) => {
    const p = D.worldPct;
    if (pppDay <= p[0]) return 0.5;
    for (let i = 0; i < p.length - 1; i++) {
      if (pppDay < p[i + 1]) return i + 1 + (pppDay - p[i]) / (p[i + 1] - p[i]);
    }
    return 99.5;
  };
  // local currency (2026 prices) per 2021-PPP dollar
  E.lcuPerPPP = (iso) => D.c[iso].gl / D.c[iso].gk;
  E.meanEarnMonth = (iso) => (D.c[iso].earn[0] * D.c[iso].gl) / 12;
  // national survey mean income per person per month in local currency
  E.natMeanPC = (iso) => (D.c[iso].sr * D.c[iso].gl) / 12;

  function asfr(iso, age, year) {
    const a = D.c[iso].asfr;
    if (age < 15 || age >= 50) return age >= 12 && age < 15 ? (a[0][0] / 1000) * 0.15 : 0;
    const gi = Math.min(6, Math.floor((age - 15) / 5));
    const t = clamp((year - D.asfrYears[0]) / (D.asfrYears[1] - D.asfrYears[0]), 0, 1);
    return ((a[0][gi] * (1 - t) + a[1][gi] * t) / 1000);
  }
  E.asfr = asfr;

  // ---------- money formatting ----------
  E.money = (s, lcu, opts = {}) => {
    const p = E.prof(s.iso);
    const whole = Math.abs(lcu) >= 10 || Math.abs(lcu) < 0.005;
    const v = whole ? Math.round(lcu) : Math.round(lcu * 100) / 100;
    let str;
    try {
      str = new Intl.NumberFormat("ko-KR", {
        style: "currency", currency: p.cur, currencyDisplay: "narrowSymbol",
        maximumFractionDigits: whole ? 0 : 2, notation: opts.compact ? "compact" : "standard",
      }).format(v);
    } catch (e) {
      str = v.toLocaleString("ko-KR") + " " + p.cur;
    }
    return str;
  };
  E.ppp = (s, lcu) => lcu / E.lcuPerPPP(s.iso); // to 2021 PPP $

  // ---------- life log ----------
  function log(s, text, kind = "life", extra) {
    const e = { age: Math.floor(s.age), y: s.year, m: s.month, t: text, k: kind };
    if (extra) Object.assign(e, extra);
    s.log.push(e);
    s._new.push(e);
    return e;
  }
  E.log = log;
  const add = (s, key, v) => (s.st[key] = clamp(s.st[key] + v, 0, 100));
  E.add = add;

  // ---------- names ----------
  function nameFor(s, iso, sex, family) {
    const p = E.prof(iso);
    const [ms, fs, fam] = p.names;
    const given = R.pick(s, sex === "m" ? ms : fs);
    const f = family !== undefined ? family : R.pick(s, fam);
    if (!f) return given;
    if (p.koreanName) return f + given;
    return p.eastName ? f + " " + given : given + " " + f;
  }
  E.nameFor = nameFor;

  // ---------- education ----------
  // 0 none, 1 primary, 2 lower secondary, 3 upper secondary, 4 post-secondary/vocational college,
  // 5 bachelor, 6 master, 7 doctorate
  E.EDU = ["학교 못 다님", "초등학교", "중학교", "고등학교", "전문대·직업학교", "대학교", "석사", "박사"];
  function adultEduDist(iso) {
    const ba = Wp(iso, "SE.TER.CUAT.BA.ZS", 0.1), up = Math.max(ba, Wp(iso, "SE.SEC.CUAT.UP.ZS", 0.3)), pr = Math.max(up, Wp(iso, "SE.PRM.CUAT.ZS", 0.7));
    // cumulative from the bottom
    return [1 - pr, (pr - up) * 0.5, (pr - up) * 0.5, (up - ba) * 0.7, (up - ba) * 0.3, ba * 0.85, ba * 0.13, ba * 0.02];
  }
  function eduFromRank(iso, r) {
    const dist = adultEduDist(iso);
    let acc = 0;
    for (let i = 0; i < dist.length; i++) {
      acc += dist[i];
      if (r < acc) return i;
    }
    return dist.length - 1;
  }

  // ---------- occupations and pay ----------
  const SKILL = { 1: 1.5, 2: 1.6, 3: 1.0, 4: 0.5, 5: 0, 6: -1, 7: 0, 8: 0, 9: -1.2 };
  function eduFit(isco, edu) {
    if (isco === 2) return edu >= 5 ? 1 : edu === 4 ? 0.12 : 0.02;
    if (isco === 1) return edu >= 5 ? 1 : edu >= 3 ? 0.5 : 0.15;
    if (isco === 3) return edu >= 4 ? 1 : edu === 3 ? 0.5 : 0.1;
    if (isco === 4) return edu >= 3 ? 1 : edu === 2 ? 0.35 : 0.08;
    if (isco === 6 || isco === 9) return edu >= 5 ? 0.15 : edu >= 4 ? 0.4 : 1;
    if (isco === 7 || isco === 8) return edu >= 5 ? 0.25 : 1;
    return edu >= 6 ? 0.3 : 1; // 5
  }
  E.eduFit = eduFit;
  function occShare(iso, sex, isco) {
    return D.c[iso].occ[sex][isco - 1] / 1000;
  }
  E.occShare = occShare;
  function jobTitle(s, isco, urban, iso) {
    const p = E.prof(iso || s.iso);
    const pool = C.jobs[isco][urban ? "urban" : "rural"].slice();
    if (isco === 6 && p.farm && !urban) pool.push(p.farm, p.farm);
    if (isco === 8 && p.moto && D.c[p.iso].i !== "HIC") pool.push(p.moto, p.moto);
    if (isco === 5 && p.gig && urban) pool.push(p.gig);
    if (isco === 9 && p.gig && urban && D.c[p.iso].i === "HIC") pool.push(p.gig);
    if (isco === 8 && p.garment && urban) pool.push("봉제 공장 재봉사", "봉제 공장 재봉사");
    if (isco === 9 && p.mining && !urban) pool.push(p.mining);
    return R.pick(s, pool);
  }
  E.jobTitle = jobTitle;
  const EDU_PAY = [0.82, 0.88, 0.94, 1.0, 1.08, 1.22, 1.38, 1.5];
  function expPay(years, age) {
    const e = clamp(years, 0, 40);
    let m = 0.62 + 0.38 * (1 - Math.exp(-e / 7)) + 0.004 * Math.min(e, 30);
    if (age > 58) m *= 1 - (age - 58) * 0.01;
    return m;
  }
  // monthly pay in local currency for a job held by s
  function payFor(s, job) {
    const iso = job.iso || s.iso;
    const d = D.c[iso];
    let p = E.meanEarnMonth(iso) * (d.earn[job.isco] || 1);
    p *= EDU_PAY[s.edu.level] * expPay(s.exp, s.age) * job.indiv;
    if (job.informal) p *= 0.62;
    if (job.self) p *= 0.85;
    if (s.sex === "f") p *= 0.85; // ILO: women earn ~15-20% less on average worldwide
    if (job.migrant) p *= job.migrant;
    if (job.elite) p *= 1.15;
    if (job.part) p *= 0.5;
    return p;
  }
  E.payFor = payFor;

  function informalChance(s, isco, iso) {
    iso = iso || s.iso;
    let base = W(iso, "SL.ISV.IFRM.ZS");
    if (base == null) base = D.c[iso].i === "HIC" ? 12 : D.c[iso].i === "UMC" ? 45 : 75;
    let p = base / 100;
    if (isco === 6 || isco === 9) p = Math.min(0.97, p * 1.25 + 0.05);
    if (isco === 2 || isco === 1) p *= 0.4;
    if (isco === 3 || isco === 4) p *= 0.6;
    if (s.edu.level >= 5) p *= 0.6;
    return clamp(p, 0.02, 0.97);
  }
  E.informalChance = informalChance;

  // a job offer drawn from the real occupation mix, filtered by education
  function makeOffer(s, opts = {}) {
    const iso = opts.iso || s.iso;
    const urban = opts.urban != null ? opts.urban : s.urban;
    const isco = opts.isco || R.weighted(s, [1, 2, 3, 4, 5, 6, 7, 8, 9], (k) => {
      let w = occShare(iso, s.sex, k) * eduFit(k, s.edu.level);
      if (k === 6) w *= urban ? 0.12 : 2.5;
      if (k === 1) w *= clamp((s.exp - 3) / 10, 0.05, 1.2);
      if (opts.major) w *= 0.3 + 3 * C.majors[opts.major].w[k - 1];
      if (opts.prefer) w *= opts.prefer[k] || 1;
      return w;
    });
    const informal = opts.formal ? false : R.chance(s, informalChance(s, isco, iso));
    const self = !informal ? R.chance(s, isco === 6 ? 0.7 : isco === 5 ? 0.25 : 0.06) : R.chance(s, isco === 6 || isco === 5 ? 0.6 : 0.3);
    let title = opts.title || jobTitle(s, isco, urban, iso);
    if (opts.major && isco === 2 && R.chance(s, 0.6)) title = R.pick(s, C.majors[opts.major].titles);
    const job = {
      isco, title, informal, self, iso,
      indiv: Math.exp(R.normal(s, 0, 0.22) + (s.st.smarts - 50) / 250 + (s.st.social - 50) / 400),
      since: s.age, perf: 0, elite: !!s.edu.elite && isco <= 3,
    };
    if (opts.migrant) job.migrant = opts.migrant;
    job.pay = payFor(s, job);
    return job;
  }
  E.makeOffer = makeOffer;

  // ---------- household money ----------
  function eqSize(s) {
    let n = 1;
    if (s.partner && s.partner.status === "married" && s.partner.alive) n += 0.7;
    n += s.kids.filter((k) => k.alive && s.year - k.born < 20).length * 0.5;
    return n;
  }
  E.eqSize = eqSize;
  function needsMonth(s) {
    // basic needs per adult-equivalent: the larger of the $3/day line and 45% of the national mean
    const pov = 3 * 30.4 * E.lcuPerPPP(s.iso);
    return eqSize(s) * Math.max(pov, 0.45 * E.natMeanPC(s.iso));
  }
  E.needsMonth = needsMonth;
  function householdIncome(s) {
    let inc = 0;
    if (s.job) inc += s.job.pay;
    if (s.partner && s.partner.status === "married" && s.partner.alive && s.partner.pay) inc += s.partner.pay;
    if (s.pension) inc += s.pension;
    if (s.business) inc += s.business.monthly;
    return inc;
  }
  E.householdIncome = householdIncome;
  E.dependent = (s) => !s.indep;
  // per-person household income in 2021 PPP $/day (for the world comparison)
  E.perCapitaPPP = (s) => {
    if (!s.indep) return s.fam.pcDay;
    const people = 1 + (s.partner && s.partner.status === "married" && s.partner.alive ? 1 : 0) + s.kids.filter((k) => k.alive && s.year - k.born < 20).length;
    const inc = householdIncome(s);
    return Math.max(0.5, E.ppp(s, inc) / 30.4 / people);
  };
  // where the household sits in the national distribution (0..1)
  E.natPct = (s) => {
    const x = E.perCapitaPPP(s);
    let lo = 0, hi = 1;
    for (let i = 0; i < 25; i++) {
      const mid = (lo + hi) / 2;
      if (incomeAt(s.iso, mid) < x) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2;
  };

  // ---------- mortality ----------
  // risk factors: each scales some causes. Normalized by the population average so that a
  // "typical" person reproduces the life table.
  const RF = {
    smoke: { ca_lung: 10, copd: 5, ihd: 2, stroke: 1.8, ca_esoph: 3, ca_other: 1.35, ca_stomach: 1.5, resp_inf: 1.4, tb: 1.6, diabetes: 1.3, ca_pancreas: 1.8 },
    drink: { cirrhosis: 5, alcohol: 25, road: 2, ca_liver: 2, ca_esoph: 2.5, injury_other: 1.5, suicide: 1.8, homicide: 1.5, stroke: 1.4 },
  };
  function rfMult(rr, own, prev, cause) {
    const r = rr[cause];
    if (!r) return 1;
    const avg = 1 + prev * (r - 1);
    return (own ? r : 1) / avg;
  }
  function causeWeights(s) {
    const sh = causeShares(s.iso, s.sex, s.age);
    const smokePrev = Wp(s.iso, s.sex === "m" ? "SH.PRV.SMOK.MA" : "SH.PRV.SMOK.FE", 0.2);
    const alc = W(s.iso, "SH.ALC.PCAP.LI") || 5;
    const drinkPrev = (s.sex === "m" ? 0.012 : 0.003) * alc;
    // childhood circumstances and current income both matter
    const u = s.indep ? 0.5 * s.fam.u + 0.5 * E.natPct(s) : s.fam.u;
    const manual = manualAvg(s.iso, s.sex);
    const smokeLevel = s.habit.smoke ? 1 : s.habit.quitAt != null ? Math.max(0, 1 - (s.age - s.habit.quitAt) / 15) : 0;
    const out = [];
    for (let i = 0; i < sh.length; i++) {
      const k = D.causes[i];
      let w = sh[i];
      if (!w) { out.push(0); continue; }
      // smoking: partial for former smokers
      const ms = rfMult(RF.smoke, true, smokePrev, k), mn = rfMult(RF.smoke, false, smokePrev, k);
      w *= mn + (ms - mn) * smokeLevel;
      w *= rfMult(RF.drink, s.habit.drink >= 2, drinkPrev, k);
      if (INFECT.includes(k) || k === "maternal") w *= Math.exp(-1.1 * (u - 0.5));
      else if (INJURY.includes(k)) w *= Math.exp(-0.5 * (u - 0.5));
      else w *= Math.exp(-0.3 * (u - 0.5));
      if (k === "injury_other" || k === "falls") w *= (s.job && !s.retired ? JOB_INJ[s.job.isco] : 0.9) / manual;
      if (s.job && !s.retired) {
        if (k === "road") w *= s.job.isco === 8 ? 1.9 : 1;
        if (k === "road" && s.job.moto) w *= 2.2;
      }
      if (s.army && s.army.active) {
        if (k === "war") w *= E.prof(s.iso).war ? 25 : 1;
        if (k === "injury_other") w *= 1.5;
      }
      if (k === "maternal") w = 0; // handled at each birth
      if (k === "suicide") w *= s.st.happy < 25 ? 2.2 : s.st.happy < 40 ? 1.4 : s.st.happy > 70 ? 0.6 : 1;
      if (s.cond[k]) w *= s.cond[k].treated ? 1.4 : 3;
      if (k === "war" && s.conflictZone) w *= 3;
      out.push(w);
    }
    return { sh, w: out };
  }
  E.causeWeights = causeWeights;
  // injury risk by occupation, normalized by the country's own occupation mix
  const JOB_INJ = { 1: 0.6, 2: 0.6, 3: 0.7, 4: 0.6, 5: 0.9, 6: 1.5, 7: 1.8, 8: 1.7, 9: 1.8 };
  const MANUAL = {};
  function manualAvg(iso, sex) {
    const k = iso + sex;
    if (MANUAL[k]) return MANUAL[k];
    let a = 0;
    for (let i = 1; i <= 9; i++) a += occShare(iso, sex, i) * JOB_INJ[i];
    return (MANUAL[k] = a * 0.7 + 0.9 * 0.3); // ~30% of adults are not working
  }
  // the health stat relative to the age norm: 10 points above norm ~ 0.67x mortality
  E.healthNorm = (age) => clamp(80 - Math.max(0, age - 25) * 0.55 - Math.max(0, age - 60) * 0.35, 15, 80);
  function mortMult(s) {
    const { sh, w } = causeWeights(s);
    let base = 0, now = 0;
    for (let i = 0; i < sh.length; i++) {
      if (D.causes[i] === "maternal" && s.sex === "f") { base += sh[i]; continue; }
      base += sh[i];
      now += w[i];
    }
    const rel = (s.st.health - E.healthNorm(s.age) + 2) / 25;
    return (now / Math.max(1e-9, base)) * Math.exp(-rel) * E.CALIB;
  }
  E.mortMult = mortMult;
  E.annualRisk = (s) => clamp(E.annualQ(s.iso, s.sex, s.age, s.year) * mortMult(s), 0, 0.95);
  function sampleCause(s) {
    const { w } = causeWeights(s);
    const keys = D.causes.map((k, i) => i);
    return D.causes[R.weighted(s, keys, (i) => w[i])];
  }
  E.sampleCause = sampleCause;
  // someone else's death (parent, spouse): annual probability and a cause for the narration
  E.otherQ = (iso, sex, age, year) => clamp(E.annualQ(iso, sex, age, year), 0, 0.95);
  E.otherCause = (s, iso, sex, age) => {
    const sh = causeShares(iso, sex, age);
    const keys = D.causes.map((k, i) => i);
    return D.causes[R.weighted(s, keys, (i) => sh[i])];
  };

  // ---------- new life ----------
  const START_YEAR = D.year;
  function pickCountry(s) {
    const isos = Object.keys(D.c);
    return R.weighted(s, isos, (k) => D.c[k].p[0] + D.c[k].p[1]);
  }

  E.newLife = function (opts = {}) {
    const seed = opts.seed != null ? opts.seed >>> 0 : (Math.random() * 4294967296) >>> 0;
    const s = {
      v: 1, seed, rng: seed, mode: opts.custom ? "custom" : "random",
      log: [], _new: [], queue: [], decided: {}, history: [], checkpoints: [],
      st: { health: 70, happy: 60, smarts: 50, social: 55 },
      cond: {}, habit: { smoke: false, drink: 0, exercise: 0 },
      kids: [], jobsHeld: [], threads: [], focusMonths: {}, styleMonths: {}, focus: "balance", style: "normal", savings: 0, debt: 0, exp: 0,
      indep: false, job: null, partner: null, pension: 0, business: null, retired: false,
      month: 0, plan: opts.plan || "",
    };
    rnd(s); rnd(s);
    const c = opts.custom || {};
    s.iso = c.iso || pickCountry(s);
    const d = D.c[s.iso];
    s.sex = c.sex || (R.chance(s, d.p[0] / (d.p[0] + d.p[1])) ? "m" : "f");
    s.age = c.age || 14;
    s.year = START_YEAR;
    s.birthYear = START_YEAR - Math.floor(s.age);
    s.startAge = s.age;
    s.homeIso = s.iso;
    const p = E.prof(s.iso);

    // family position in the national income distribution, and city vs village
    const u = c.wealth != null ? clamp((c.wealth - 0.5) / 5 + R.normal(s, 0, 0.04), 0.01, 0.99) : R.f(s);
    const urb = Wp(s.iso, "SP.URB.TOTL.IN.ZS", 0.5);
    s.urban = c.urban != null ? c.urban : R.chance(s, shift(urb * 0.94, 1.6 * (u - 0.5)));
    const pcDay = incomeAt(s.iso, u);
    s.place = R.pick(s, s.urban ? p.cities : p.rural);
    s.talent = R.normal(s, 0, 1);

    // parents
    const mac = d.mac || 28;
    const mAge0 = clamp(Math.round(R.normal(s, mac - 1, 5)), 15, 44);
    const fAge0 = clamp(Math.round(mAge0 + R.normal(s, (p.arranged || 0) > 0.3 ? 6 : 3.5, 3)), 16, 60);
    const zEdu = 0.65 * normInv(u) + 0.76 * R.normal(s);
    const fEdu = eduFromRank(s.iso, normCdf(zEdu));
    const mEdu = eduFromRank(s.iso, normCdf(0.7 * zEdu + 0.71 * R.normal(s)));
    const parentJob = (sex, edu) => {
      const lfp = Wp(s.iso, sex === "m" ? "SL.TLF.CACT.MA.ZS" : "SL.TLF.CACT.FE.ZS", 0.6);
      if (!R.chance(s, clamp(lfp * 1.25, 0.1, 0.97))) return null;
      const isco = R.weighted(s, [1, 2, 3, 4, 5, 6, 7, 8, 9], (k) => {
        let w = occShare(s.iso, sex, k) * eduFit(k, edu) * Math.exp(2 * (u - 0.5) * SKILL[k]);
        if (k === 6) w *= s.urban ? 0.12 : 3;
        return w;
      });
      return { isco, title: jobTitle(s, isco, s.urban) };
    };
    const famName = p.patronymic ? undefined : R.pick(s, p.names[2]);
    const fatherGiven = R.pick(s, p.names[0]);
    s.fam = {
      u, pcDay,
      father: { age: fAge0 + s.age, edu: fEdu, job: parentJob("m", fEdu), alive: true, name: fatherGiven },
      mother: { age: mAge0 + s.age, edu: mEdu, job: parentJob("f", mEdu), alive: true },
      rel: R.weighted(s, p.rel, (x) => x[1])[0],
    };
    const tfr0 = (d.tfr[0] || 2) * (d.tfr[0] > 2.5 ? 1.12 : 1.03);
    s.fam.sibs = clamp(Math.round(R.normal(s, tfr0 - 1 + (0.5 - u) * tfr0 * 0.35, 0.9 + 0.15 * tfr0)), 0, 11);
    // a parent may already have died: life-table survival over the 14 years since the birth
    for (const [who, sex] of [["father", "m"], ["mother", "f"]]) {
      const par = s.fam[who];
      const surv = E.survival(s.iso, sex, par.age - s.age, par.age, START_YEAR - s.age);
      if (!R.chance(s, Math.pow(surv, 1.15))) {
        par.alive = false;
        par.diedAge = R.int(s, 1, Math.max(1, Math.floor(s.age) - 1));
        par.cause = E.otherCause(s, s.iso, sex, par.age - s.age + par.diedAge);
      }
    }
    const surname = p.patronymic ? fatherGiven : famName;
    s.name = c.name || nameFor(s, s.iso, s.sex, surname);
    s.famName = surname;

    s.edu = { level: 2, stage: "low", inSchool: true, elite: false, major: null };
    s.st.health = clamp(74 + 10 * (u - 0.5) + R.normal(s, 0, 6), 25, 95);
    s.st.happy = clamp(62 + R.normal(s, 0, 9), 20, 92);
    s.st.social = clamp(55 + R.normal(s, 0, 11), 15, 92);
    s.st.smarts = clamp(50 + 14 * (0.6 * s.talent + 0.35 * normInv(u) + 0.25 * R.normal(s)), 5, 97);

    s.child = {};
    if (!opts.custom) E.childhood(s);
    else E.customStart(s, c);
    E.calibrate(s);
    E.scheduleYear(s);
    return s;
  };

  // what happened before 14, drawn from the country's real rates
  E.childhood = function (s) {
    const p = E.prof(s.iso), d = D.c[s.iso], u = s.fam.u;
    const rural = !s.urban;
    // stunting in early childhood
    const stunt = shift(Wp(s.iso, "SH.STA.STNT.ZS", 0.2), -1.4 * (u - 0.5) + (rural ? 0.3 : -0.2));
    s.child.stunted = R.chance(s, stunt);
    if (s.child.stunted) { add(s, "health", -9); add(s, "smarts", -5); }
    s.child.stuntP = stunt;
    // electricity and water at home
    s.child.noPower = !R.chance(s, shift(Wp(s.iso, "EG.ELC.ACCS.ZS", 0.9), 1.6 * (u - 0.5) + (rural ? -0.8 : 0.8)));
    s.child.noWater = !R.chance(s, shift(Wp(s.iso, "SH.H2O.BASW.ZS", 0.9), 1.6 * (u - 0.5) + (rural ? -0.8 : 0.8)));
    s.child.internet = R.chance(s, shift(Wp(s.iso, "IT.NET.USER.ZS", 0.5) * 0.85, 2 * (u - 0.5) + (rural ? -0.6 : 0.6)));
    // in school at 14? (out-of-school rate for lower secondary age, by sex)
    const oos = Wp(s.iso, s.sex === "m" ? "SE.SEC.UNER.LO.MA.ZS" : "SE.SEC.UNER.LO.FE.ZS", 0.15);
    s.child.oosP = oos;
    const out = R.chance(s, shift(oos, -1.8 * (u - 0.5) + (rural ? 0.4 : -0.3) - 0.25 * s.talent));
    // child marriage by 15 (girls; % of women 20-24 married by 15)
    const m15 = Wp(s.iso, "SP.M15.2024.FE.ZS", 0.02);
    s.child.m15P = m15;
    if (s.sex === "f" && R.chance(s, shift(m15 * 0.55, -1.2 * (u - 0.5) + (rural ? 0.4 : -0.4)))) {
      s.partner = { name: nameFor(s, s.iso, "m"), age: s.age + clamp(Math.round(R.normal(s, 8, 4)), 2, 25), status: "married", since: s.age - R.f(s) * 0.8, alive: true, arranged: true, sex: "m" };
      E.partnerJob(s);
      s.child.married = true;
    }
    // working at 14 (children 7-14 in employment)
    const cl = Wp(s.iso, "SL.TLF.0714.ZS", 0.05);
    s.child.workP = cl;
    const work = R.chance(s, shift(Math.min(0.9, cl * 1.4), -1.3 * (u - 0.5) + (rural ? 0.5 : -0.3) + (out ? 1.2 : 0)));
    if (out || s.child.married) {
      s.edu.inSchool = false;
      s.edu.stage = null;
      s.edu.level = R.chance(s, 0.6) ? 1 : out && R.chance(s, oos) ? 0 : 1;
      add(s, "smarts", -10);
    }
    if (work) {
      s.child.work = rural ? (R.chance(s, 0.6) ? "가족 농사일" : "가축 돌보기") : R.pick(s, ["시장에서 물건 팔기", "작업장 심부름", "남의 집 가사일", "길거리 행상"]);
      if (s.sex === "f" && !rural && R.chance(s, 0.4)) s.child.work = "남의 집 가사일";
      if (out) {
        // a working child out of school: a real (tiny) income, informal
        const isco = rural ? 6 : s.child.work === "남의 집 가사일" ? 9 : 5;
        s.job = makeOffer(s, { isco, title: s.child.work });
        s.job.informal = true; s.job.child = true; s.job.indiv *= 0.4;
        s.job.pay = payFor(s, s.job);
      }
    }
    if (out && !s.job && !s.child.married) { s.looking = true; s.teenWork = true; }
    // a younger sibling who died (under-5 mortality applied to each sibling)
    const q5 = (d.q5 || 30) / 1000 * 1.6; // children born a decade ago faced higher rates
    let lost = 0;
    for (let i = 0; i < s.fam.sibs; i++) if (R.chance(s, shift(q5, -1 * (u - 0.5)))) lost++;
    s.child.sibLost = lost;
    if (lost) add(s, "happy", -3);
    if (!s.fam.father.alive || !s.fam.mother.alive) add(s, "happy", -8);
    if (s.child.noPower) add(s, "smarts", -2);
    s.child.malaria = (W(s.iso, "SH.MLR.INCD.P3") || 0) > 50 && R.chance(s, 0.5);

    // narrative of 0-13
    const L = [];
    const urbWord = s.urban ? `${s.place}에서` : `${s.place}에서`;
    L.push(`${START_YEAR - 14}년, ${p.ko} ${urbWord} ${s.sex === "m" ? "남자아이" : "여자아이"}로 태어났어요. 이름은 ${s.name}.`);
    const famLine = [];
    const pj = (x, who) => (x.alive ? (x.job ? `${who}는 ${x.job.title} 일을 해요` : `${who}는 집안일을 해요`) : `${who}는 내가 ${x.diedAge}살 때 ${C.causes[x.cause] || "병"}(으)로 돌아가셨어요`);
    famLine.push(pj(s.fam.father, "아버지"));
    famLine.push(pj(s.fam.mother, "어머니"));
    L.push(famLine.join(", ") + ".");
    L.push(s.fam.sibs ? `형제자매가 ${s.fam.sibs}명이에요${lost ? ` (그중 ${lost}명은 어릴 때 세상을 떠났어요)` : ""}.` : "외동이에요.");
    L.push(`집은 ${p.ko} 안에서 소득 하위 ${Math.round(u * 100)}% 언저리예요. 가족 한 사람당 하루 ${s.fam.pcDay.toFixed(1)}달러(구매력 기준)로 살아요. 세계 기준으로는 상위 ${Math.max(1, Math.round(100 - E.worldPct(s.fam.pcDay)))}%.`);
    if (s.child.stunted) L.push("어릴 때 영양이 부족해서 또래보다 키가 덜 자랐어요.");
    if (s.child.noPower) L.push("집에 전기가 들어오지 않아요. 밤에는 등잔이나 손전등을 써요.");
    if (s.child.noWater) L.push("깨끗한 물을 얻으려면 멀리 걸어가야 해요.");
    if (s.child.malaria) L.push("말라리아에 몇 번 걸렸지만 이겨냈어요.");
    if (s.child.married) L.push(`열세 살 무렵 집안이 정한 혼인을 했어요. 남편 ${s.partner.name}은 ${s.partner.age}살이에요.`);
    if (s.edu.inSchool) L.push(`지금은 ${p.sch.low}에 다녀요.`);
    else L.push(s.edu.level === 0 ? "학교에 다녀본 적이 없어요." : "초등학교를 다니다 그만뒀어요.");
    if (s.child.work) L.push(`${s.child.work}로 집에 보탬이 되고 있어요.`);
    L.push(`종교는 ${s.fam.rel}.`);
    s.childLines = L;
    for (const t of L) log(s, t, "child");
  };

  E.customStart = function (s, c) {
    const p = E.prof(s.iso);
    s.child = {};
    const age = s.age;
    s.edu.level = c.edu != null ? c.edu : age < 15 ? 2 : 3;
    s.edu.inSchool = !!c.student;
    if (c.student) {
      // the school stage that fits the age (and the education already finished)
      if (age < 15.5) { s.edu.stage = "low"; s.edu.level = Math.min(s.edu.level, 2); }
      else if (age < 18.5 && s.edu.level < 3) { s.edu.stage = "up"; s.edu.end = 18.5; s.edu.level = 2; }
      else { s.edu.stage = "uni"; s.edu.major = c.major || "hum"; s.edu.level = Math.max(3, Math.min(4, s.edu.level)); s.edu.end = age + Math.max(1, 22.5 - age); s.edu.rank = 0.5; }
    }
    if (c.isco) {
      s.exp = Math.max(0, age - 22);
      s.job = makeOffer(s, { isco: c.isco, formal: c.formal });
      s.indep = true;
    }
    if (c.married) {
      s.partner = { name: nameFor(s, s.iso, s.sex === "m" ? "f" : "m"), age: age + (s.sex === "m" ? -2 : 2), status: "married", since: age - 2, alive: true, sex: s.sex === "m" ? "f" : "m" };
      E.partnerJob(s);
      s.indep = true;
    }
    for (let i = 0; i < (c.kids || 0); i++) s.kids.push({ name: nameFor(s, s.iso, R.chance(s, 0.5) ? "m" : "f", s.famName), sex: "?", born: START_YEAR - R.int(s, 0, 10), alive: true });
    if (age >= 20 && !s.edu.inSchool) s.indep = true;
    s.savings = (c.savingsMonths || 0) * (s.job ? s.job.pay : needsMonth(s));
    if (!s.job && !s.edu.inSchool) { s.looking = true; s.teenWork = age < 18; }
    const L = [`${p.ko} ${s.place}에 사는 ${Math.floor(age)}살 ${s.sex === "m" ? "남자" : "여자"} ${s.name}의 인생을 이어서 살아요.`];
    L.push(`학력은 ${E.EDU[s.edu.level]}${s.edu.inSchool ? " 재학 중" : ""}.`);
    if (s.job) L.push(`지금 ${s.job.title}(으)로 일하고, 한 달에 ${E.money(s, s.job.pay)}를 벌어요.`);
    if (s.partner) L.push(`배우자 ${s.partner.name}와 함께 살아요.`);
    if (s.kids.length) L.push(`아이가 ${s.kids.length}명 있어요.`);
    if (s.plan) L.push(`내 계획: ${s.plan}`);
    s.childLines = L;
    for (const t of L) log(s, t, "child");
  };

  // partner's work and pay (assortative: similar education, the national female/male LFP)
  E.partnerJob = function (s) {
    const pt = s.partner;
    const psex = pt.sex || (s.sex === "m" ? "f" : "m");
    pt.sex = psex;
    const lfp = Wp(s.iso, psex === "m" ? "SL.TLF.CACT.MA.ZS" : "SL.TLF.CACT.FE.ZS", 0.6);
    pt.edu = clamp(Math.round(s.edu.level + R.normal(s, 0, 1)), 0, 7);
    if (!R.chance(s, clamp(lfp * 1.15, 0.1, 0.95))) { pt.job = null; pt.pay = 0; return; }
    const isco = R.weighted(s, [1, 2, 3, 4, 5, 6, 7, 8, 9], (k) => occShare(s.iso, psex, k) * eduFit(k, pt.edu) * (k === 6 ? (s.urban ? 0.1 : 3) : 1));
    const informal = R.chance(s, informalChance(s, isco));
    let pay = E.meanEarnMonth(s.iso) * (D.c[s.iso].earn[isco] || 1) * EDU_PAY[pt.edu] * Math.exp(R.normal(s, 0, 0.25)) * (informal ? 0.62 : 1) * (psex === "f" ? 0.85 : 1);
    pt.job = { isco, title: jobTitle(s, isco, s.urban) };
    pt.pay = pay;
  };

  // one-off scaling so that this country's simulated people match the WPP life table on average
  // average of the multiplier over simulated lives comes out above 1 (illness histories,
  // poorer-than-average households); this keeps simulated lifespans on the life table
  E.CALIB = 1.08;
  E.calibrate = function () {};

  // ---------- the clock ----------
  E.FOCUS = {
    balance: { ko: "균형", d: { health: 0.3, happy: 0.3, smarts: 0.4, social: 0.3 } },
    study: { ko: "공부", d: { smarts: 3.2, happy: -1.2, social: -0.6, health: -0.3 } },
    work: { ko: "일", d: { happy: -0.8, health: -0.6, social: -0.2 } },
    people: { ko: "사람", d: { social: 3, happy: 1.2, smarts: -0.4 } },
    health: { ko: "건강", d: { health: 2.6, happy: 0.6 } },
    rest: { ko: "놀기", d: { happy: 2.6, smarts: -1, health: 0.2 } },
  };
  E.STYLE = { frugal: { ko: "절약", s: 0.45 }, normal: { ko: "보통", s: 0.75 }, comfortable: { ko: "여유", s: 1.0 } };

  // advance one month. Returns {events, decision, dead}
  E.step = function (s) {
    s._new = [];
    if (s.dead) return { events: [], decision: null, dead: true };
    if (s.pending) return { events: [], decision: s.pending, dead: false };
    s.month++;
    if (s.month >= 12) { s.month = 0; s.year++; }
    s.age += 1 / 12;
    const birthday = s.month === 0;

    E.monthMoney(s);
    E.monthStats(s);
    E.monthPeople(s);
    if (E.monthDeath(s)) return { events: s._new, decision: null, dead: true };
    if (E.EVENTS) E.EVENTS.monthly(s);
    if (birthday) E.scheduleYear(s);
    // decisions queued for this month: open the first that applies, the rest wait a month
    const due = s.queue.filter((q) => q.at <= s.age + 1e-6).sort((a, b) => a.at - b.at);
    if (due.length && !s.dead) {
      s.queue = s.queue.filter((q) => q.at > s.age + 1e-6);
      let i = 0;
      for (; i < due.length; i++) {
        const dec = E.EVENTS.open(s, due[i].id, due[i].arg);
        if (dec) { s.pending = dec; i++; break; }
      }
      for (; i < due.length; i++) s.queue.push(Object.assign(due[i], { at: s.age + 1 / 12 }));
    }
    return { events: s._new, decision: s.pending || null, dead: false };
  };

  // pocket money for a child living with the family
  E.pocket = (s) => E.natMeanPC(s.iso) * 0.02 * Math.exp(1.2 * (s.fam.u - 0.5));
  E.monthMoney = function (s) {
    if (!s.indep) {
      // the family pays for living costs; a working teenager keeps about half of the pay
      s.savings += E.pocket(s) + (s.job ? s.job.pay * 0.5 : 0);
      return;
    }
    const inc = householdIncome(s);
    const need = needsMonth(s);
    const st = E.STYLE[s.style].s;
    let spend = need + st * Math.max(0, inc - need);
    if (inc < need && s.savings <= 0) spend = Math.max(inc, need * 0.7);
    if (s.parentSupport) spend += s.parentSupport;
    s.spend = spend;
    s.savings += inc - spend;
    // real interest on savings / debt
    const infl = clamp((W(s.iso, "FP.CPI.TOTL.ZG") || 3) / 100, -0.02, 0.6);
    const dep = (W(s.iso, "FR.INR.DPST") || 3) / 100;
    const lend = (W(s.iso, "FR.INR.LEND") || 10) / 100;
    if (s.savings > 0) s.savings *= 1 + clamp(dep - infl, -0.15, 0.04) / 12;
    else s.savings *= 1 + clamp(lend - infl, 0.02, 0.3) / 12;
    if (s.invest) {
      for (const k in s.invest) s.invest[k].v *= 1 + s.invest[k].r / 12;
    }
    // living standard -> wellbeing (relative to the national mean)
    const ratio = (spend / eqSize(s)) / Math.max(1, E.natMeanPC(s.iso));
    add(s, "happy", clamp(Math.log(ratio) * 0.25, -0.5, 0.35));
    if (inc < need * 0.7 && s.savings < 0) { add(s, "health", -0.25); add(s, "happy", -0.4); }
  };

  E.monthStats = function (s) {
    const f = E.FOCUS[s.focus];
    for (const k in f.d) add(s, k, f.d[k] / 12);
    s.focusMonths[s.focus] = (s.focusMonths[s.focus] || 0) + 1;
    if (s.indep) s.styleMonths[s.style] = (s.styleMonths[s.style] || 0) + 1;
    // health drifts toward an age-dependent target set by lifestyle
    // (smoking, drinking and poverty already raise specific causes of death; here only a little)
    let target = E.healthNorm(s.age) + (s.focus === "health" ? 8 : 0) - (s.habit.smoke ? 3 : 0) - (s.habit.drink >= 2 ? 3 : 0) + (s.hobby === "sport" ? 3 : 0);
    if (s.indep && E.perCapitaPPP(s) < 3) target -= 3;
    for (const k in s.cond) if (!s.cond[k].treated) target -= 6;
    s.st.health += (target - s.st.health) * 0.012;
    // happiness and social drift toward a baseline
    const baseHappy = 58 + (s.partner && s.partner.status !== "none" && s.partner.alive ? 5 : 0) + (s.st.social - 50) * 0.15 + (s.st.health - 60) * 0.1 + (s.looking ? -8 : 0);
    s.st.happy += (baseHappy - s.st.happy) * 0.02;
    s.st.social += (52 - s.st.social) * 0.008;
    // learning while in school
    if (s.edu.inSchool) add(s, "smarts", 0.12);
    else if (s.age > 25) s.st.smarts += (45 - s.st.smarts) * 0.002;
    if (s.job && !s.retired) {
      s.exp += 1 / 12;
      s.job.pay = payFor(s, s.job) * (1 + (s.job.perf || 0));
    }
  };

  // family members age and may die
  E.monthPeople = function (s) {
    if (s.month !== 6) return; // checked once a year, mid-year
    for (const [who, sex, word] of [["father", "m", "아버지"], ["mother", "f", "어머니"]]) {
      const par = s.fam[who];
      if (!par.alive) continue;
      par.age += 1;
      if (R.chance(s, E.otherQ(s.homeIso, sex, par.age, s.year))) {
        par.alive = false;
        par.cause = E.otherCause(s, s.homeIso, sex, par.age);
        log(s, `${word}가 ${par.age}살에 ${C.causes[par.cause]}(으)로 돌아가셨어요.`, "loss");
        add(s, "happy", -14);
        if (s.fam.u > 0.6 && s.indep) {
          const inh = E.natMeanPC(s.iso) * 12 * Math.exp(5 * (s.fam.u - 0.6)) / Math.max(1, s.fam.sibs + 1) * R.f(s);
          if (inh > E.natMeanPC(s.iso)) { s.savings += inh; log(s, `유산으로 ${E.money(s, inh)}를 물려받았어요.`, "money"); }
        }
      }
    }
    if (s.partner && s.partner.alive && s.partner.status === "married") {
      s.partner.age += 1;
      if (R.chance(s, E.otherQ(s.iso, s.partner.sex, s.partner.age, s.year))) {
        s.partner.alive = false;
        const cause = E.otherCause(s, s.iso, s.partner.sex, s.partner.age);
        log(s, `배우자 ${s.partner.name}가 ${s.partner.age}살에 ${C.causes[cause]}(으)로 세상을 떠났어요.`, "loss");
        add(s, "happy", -22);
        s.widowed = true;
      }
    }
    for (const k of s.kids) {
      if (!k.alive) continue;
      const kage = s.year - k.born;
      // under-5 deaths: ~60% in the first year, the rest spread over ages 1-4
      const q = kage < 5
        ? ((D.c[s.iso].q5 || 20) / 1000) * (kage === 0 ? 0.6 : 0.1) * Math.exp(-1.1 * ((s.indep ? E.natPct(s) : s.fam.u) - 0.5))
        : E.otherQ(s.iso, k.sex === "f" ? "f" : "m", Math.max(10, kage), s.year);
      if (R.chance(s, q)) {
        k.alive = false;
        k.died = s.year;
        const cause = kage < 5 ? R.pick(s, ["폐렴", "설사병", "말라리아", "신생아 합병증", "영양실조"].filter((x) => x !== "말라리아" || (W(s.iso, "SH.MLR.INCD.P3") || 0) > 20)) : C.causes[E.otherCause(s, s.iso, k.sex === "f" ? "f" : "m", kage)];
        log(s, `${k.name}가 ${kage}살에 ${cause}(으)로 세상을 떠났어요.`, "loss");
        add(s, "happy", -25);
      }
    }
  };

  E.monthDeath = function (s) {
    const q = E.annualRisk(s);
    const mq = 1 - Math.pow(1 - q, 1 / 12);
    if (R.chance(s, mq)) {
      const cause = sampleCause(s);
      E.die(s, cause);
      return true;
    }
    return false;
  };

  E.die = function (s, cause, note) {
    s.dead = true;
    s.pending = null;
    s.death = { age: s.age, year: s.year, cause, note: note || null };
    const p = E.prof(s.iso);
    log(s, `${s.year}년, ${Math.floor(s.age)}살에 ${C.causes[cause] || cause}(으)로 세상을 떠났어요.`, "death");
  };

  // ---------- yearly scheduling ----------
  E.scheduleYear = function (s) {
    if (E.EVENTS) E.EVENTS.yearly(s);
  };
  E.queue = function (s, id, inMonths = 0, arg) {
    if (s.queue.some((q) => q.id === id) || (s.pending && s.pending.id === id)) return;
    s.queue.push({ id, at: s.age + inMonths / 12 + 1e-4, arg });
  };

  // ---------- decisions ----------
  // where the person stands, in a few words (kept with each decision)
  E.situation = function (s) {
    const work = s.job ? s.job.title : s.business ? s.business.kind + " 운영" : s.army && s.army.active ? "군 복무" : s.edu.inSchool ? "학생" : s.retired ? "은퇴" : s.looking ? "구직 중" : "무직";
    const fam = s.partner && s.partner.alive ? (s.partner.status === "married" ? "기혼" : "연애 중") : "혼자";
    return `${E.prof(s.iso).ko} ${s.urban ? "도시" : "농촌"} · ${work} · ${fam}${s.kids.length ? ` · 자녀 ${s.kids.filter((k) => k.alive).length}` : ""} · 나라 안 하위 ${Math.round((s.indep ? E.natPct(s) : s.fam.u) * 100)}%`;
  };
  function record(s, dec, chosen, extra) {
    s.history.push(Object.assign({
      id: dec.id, title: dec.title, body: String(dec.body || "").slice(0, 160), age: Math.floor(s.age), year: s.year,
      opts: (dec.options || []).map((o) => o.label + (o.disabled ? " (불가)" : "")).slice(0, 7),
      label: chosen, ctx: E.situation(s), cp: s.checkpoints.length - 1,
    }, extra || {}));
  }
  E.choose = function (s, key) {
    const dec = s.pending;
    if (!dec) return null;
    E.checkpoint(s, dec);
    s.pending = null;
    s._new = [];
    const label = (dec.options.find((o) => o.key === key) || {}).label || key;
    const ctx = E.situation(s);
    const out = E.EVENTS.resolve(s, dec, key);
    record(s, dec, label, { key, ctx, result: out });
    return { text: out, events: s._new };
  };
  // a choice the player wrote; Claude's reading of it is applied within the game's limits
  E.chooseFree = function (s, text, res) {
    const dec = s.pending;
    if (!dec) return null;
    E.checkpoint(s, dec);
    s.pending = null;
    s._new = [];
    const ctx = E.situation(s);
    const r = E.EVENTS.resolveFree(s, dec, text, res);
    record(s, dec, "✍ " + text.slice(0, 200), { key: "free", ctx, result: r.text, ok: r.ok });
    return { text: r.text, events: s._new, ok: r.ok };
  };
  // an action written at any moment, outside a decision
  E.act = function (s, text, res) {
    const dec = { id: "act", title: "직접 한 일", body: "", options: [] };
    E.checkpoint(s, null);
    s._new = [];
    const ctx = E.situation(s);
    E.log(s, `✍ ${text}`, "free");
    const r = E.EVENTS.outcome(s, res, text);
    record(s, dec, "✍ " + text.slice(0, 200), { key: "act", ctx, result: r.text, ok: r.ok });
    return { text: r.text, events: s._new, ok: r.ok };
  };
  // Claude wrote the options of this decision (a story the player started); Claude also judged the pick
  E.chooseGenerated = function (s, label, text, res) {
    const dec = s.pending;
    if (!dec) return null;
    E.checkpoint(s, dec);
    s.pending = null;
    s._new = [];
    const ctx = E.situation(s);
    if (text) E.log(s, `✍ ${text}`, "free");
    const r = E.EVENTS.outcome(s, res, label, dec.threadId);
    record(s, dec, text ? "✍ " + text.slice(0, 200) : label, { key: text ? "free" : "gen", ctx, result: r.text, ok: r.ok });
    return { text: r.text, events: s._new, ok: r.ok };
  };

  // checkpoints: the whole state before a decision, to come back and choose differently
  // (the log and the decision history only ever grow, so a checkpoint keeps their lengths)
  E.checkpoint = function (s, dec) {
    const copy = Object.assign({}, s, { checkpoints: null, _new: null, log: null, history: null, logLen: s.log.length, histLen: s.history.length });
    copy.pending = dec;
    s.checkpoints.push(JSON.stringify(copy));
  };
  E.rewind = function (s, i) {
    const r = JSON.parse(s.checkpoints[i]);
    r.checkpoints = s.checkpoints.slice(0, i);
    r.log = s.log.slice(0, r.logLen);
    r.history = s.history.slice(0, r.histLen);
    r._new = [];
    r.rewound = (s.rewound || 0) + 1;
    return r;
  };

  // ---------- summary for the end screen ----------
  E.summary = function (s) {
    const p = E.prof(s.iso);
    const sex = s.sex;
    const e14 = s.startAge + E.survivalMean(s.homeIso, sex, s.startAge, START_YEAR);
    const lived = s.death ? s.death.age : s.age;
    // share of same-country same-sex 14-year-olds who die before this age
    const surv = E.survival(s.homeIso, sex, s.startAge, lived, START_YEAR);
    return {
      lived, e14, pctOutlived: 1 - surv, eduMax: s.edu.level, kids: s.kids.length, kidsAlive: s.kids.filter((k) => k.alive).length,
      peakWorld: s.peakWorld || 0, jobs: s.jobsHeld || [],
    };
  };
  E.survivalMean = function (iso, sex, a, y) {
    let s = 1, tot = 0;
    for (let t = a; t < 120; t++) {
      const q = 1 - Math.exp(-mx(iso, sex, t + 0.5, y + (t - a)));
      tot += s * (1 - q / 2);
      s *= 1 - q;
      if (s < 1e-5) break;
    }
    return tot;
  };
  // survival curve of the player's birth cohort (same country, same sex) from start age
  E.cohortCurve = function (s) {
    const pts = [];
    let sv = 1;
    for (let a = Math.floor(s.startAge); a <= 105; a++) {
      pts.push([a, sv]);
      sv *= 1 - E.annualQ(s.homeIso, s.sex, a + 0.5, START_YEAR + (a - s.startAge));
    }
    return pts;
  };

  G.LIFE_ENGINE = E;
})(typeof window !== "undefined" ? window : globalThis);
