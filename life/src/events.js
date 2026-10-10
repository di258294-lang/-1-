// Decisions and events. Each decision's odds come from the country's real numbers (data.js);
// the "facts" shown with a decision are those same numbers.
(function (G) {
  const E = G.LIFE_ENGINE;
  const { R, M, C, D } = E;
  const { clamp, shift, normCdf } = M;
  const W = E.W, Wp = E.Wp;
  const EV = {};
  const DEC = {};
  const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
  const fact = (t, src = "세계은행") => ({ t, src });
  const P = (s) => E.prof(s.iso);
  const money = (s, x) => E.money(s, x);
  const log = E.log, add = E.add;
  const monthly = (s) => Math.max(E.householdIncome(s), E.needsMonth(s));
  const exams = ["KOR", "JPN", "CHN", "TWN", "IND", "TUR", "IRN", "VNM", "PAK", "BGD", "EGY", "NGA"];
  const uRate = (s) => (s.age < 25 ? W(s.iso, "SL.UEM.1524.ZS") || 12 : W(s.iso, "SL.UEM.TOTL.ZS") || 6) / 100;
  const famU = (s) => (s.indep ? E.natPct(s) : s.fam.u);
  const isHIC = (s) => D.c[s.iso].i === "HIC";

  EV.open = function (s, id, arg) {
    const d = DEC[id];
    if (!d) return null;
    const dec = d.open(s, arg);
    if (!dec) return null;
    dec.id = id;
    dec.arg = arg == null ? null : arg;
    dec.age = Math.floor(s.age);
    dec.year = s.year;
    if (dec.free == null) dec.free = true;
    return dec;
  };
  EV.resolve = function (s, dec, key) {
    const opt = dec.options.find((o) => o.key === key);
    const out = DEC[dec.id].resolve(s, key, dec);
    if (out) log(s, out, "choice");
    return out;
  };

  // ---------- school ----------
  function upperRate(s) {
    // share of a cohort that goes on to upper secondary: gross secondary enrollment, capped
    return clamp(Wp(s.iso, "SE.SEC.ENRR", 0.6) * 0.92, 0.12, 0.98);
  }
  function generalShare(s) {
    return { CHN: 0.6, DEU: 0.5, AUT: 0.45, CHE: 0.35, NLD: 0.5, KOR: 0.82, JPN: 0.75, EGY: 0.45, IDN: 0.6, TUR: 0.6 }[s.iso] || 0.75;
  }
  function uniCost(s) {
    // a year of university, as a share of national mean income per person per year
    const k = { USA: 1.1, GBR: 0.7, KOR: 0.35, JPN: 0.45, CHN: 0.25, IND: 0.35, AUS: 0.6, CAN: 0.6, DEU: 0.05, FRA: 0.05, NOR: 0, SWE: 0, FIN: 0, DNK: 0, BRA: 0.15, MEX: 0.2, PHL: 0.4, NGA: 0.35 }[s.iso];
    const def = { HIC: 0.3, UMC: 0.3, LMC: 0.4, LIC: 0.6 }[D.c[s.iso].i] || 0.4;
    return E.natMeanPC(s.iso) * 12 * (k == null ? def : k);
  }
  function famCanPay(s, cost) {
    const famMonthly = s.fam.pcDay * 30.4 * E.lcuPerPPP(s.iso) * (2 + s.fam.sibs) ;
    return cost / 12 < famMonthly * 0.18 || s.savings > cost;
  }

  DEC.school_next = {
    open(s) {
      if (!s.edu.inSchool || s.edu.stage !== "low") return null;
      const p = P(s);
      const cont = upperRate(s);
      const barrier = R.chance(s, shift(1 - cont, -2.2 * (s.fam.u - 0.5) + (s.urban ? -0.3 : 0.4) + (s.sex === "f" ? 0.15 : 0) - 0.2 * s.talent));
      const ctx = { barrier };
      const facts = [
        fact(`${p.ko}에서 중등학교에 다니는 나이대 아이 비율(총취학률): ${Math.round(W(s.iso, "SE.SEC.ENRR") || 0)}%`),
        fact(`25세 이상 중 고등학교를 마친 사람: ${pct(Wp(s.iso, "SE.SEC.CUAT.UP.ZS", 0.3))}`),
      ];
      if (p.exam1) facts.unshift(fact(`${p.exam1} 결과에 따라 진로가 갈려요. 지금 내 학업 수준은 또래 상위 ${Math.round(100 - s.st.smarts)}% 정도예요.`, "게임 계산"));
      let body = `${p.sch.low} 졸업을 앞두고 있어요.`;
      if (barrier) body += ` 그런데 집에서는 학비와 생활비가 부담스럽다며 ${s.sex === "f" ? "집안일을 돕거나 일을 하길" : "돈을 벌어오길"} 바라요.`;
      const opts = [
        { key: "general", label: `${p.sch.up}에 간다`, hint: p.exam1 ? `${p.exam1} 성적이 필요해요` : "대학으로 가는 길" },
        { key: "voc", label: `${p.sch.voc}에 간다`, hint: "기술을 배워 일찍 일자리로" },
        { key: "work", label: "학교를 그만두고 일한다", hint: barrier ? "가족이 바라는 길" : "지금 돈을 번다" },
      ];
      return { title: "고등학교, 갈 수 있을까", body, facts, options: opts, ctx };
    },
    resolve(s, key, dec) {
      const p = P(s);
      if (key === "work") {
        s.edu.inSchool = false; s.edu.stage = null; s.edu.level = 2;
        s.looking = true; s.teenWork = true;
        if (dec.ctx.barrier) { add(s, "social", 2); }
        return `${p.sch.low}를 마치고 학교를 떠났어요. 이제 일을 찾아요.`;
      }
      let conflict = "";
      if (dec.ctx.barrier) {
        add(s, "happy", -6);
        // scholarship or relatives may make it possible; otherwise it stays hard
        if (!R.chance(s, 0.45 + (s.st.smarts - 50) / 120 + (s.st.social - 50) / 300)) {
          s.edu.inSchool = false; s.edu.stage = null; s.edu.level = 2; s.looking = true;
          return "학교에 가겠다고 버텼지만 결국 학비를 마련하지 못했어요. 일을 찾아야 해요.";
        }
        conflict = " 가족을 설득하는 데 진땀을 뺐어요.";
      }
      if (key === "general") {
        const admit = p.exam1 ? clamp(shift(generalShare(s), (s.st.smarts - 50) / 11), 0.03, 0.99) : 0.97;
        if (R.chance(s, admit)) {
          s.edu.stage = "up"; s.edu.end = s.age + 3;
          return `${p.exam1 ? p.exam1 + "을 통과해 " : ""}${p.sch.up}에 들어갔어요.${conflict}`;
        }
        s.edu.stage = "voc"; s.edu.end = s.age + 3;
        add(s, "happy", -5);
        return `${p.exam1} 점수가 모자라 ${p.sch.voc}로 가게 됐어요.${conflict}`;
      }
      s.edu.stage = "voc"; s.edu.end = s.age + 3;
      add(s, "smarts", 1);
      return `${p.sch.voc}에 들어갔어요.${conflict}`;
    },
  };

  DEC.school_final = {
    open(s) {
      if (!s.edu.inSchool || (s.edu.stage !== "up" && s.edu.stage !== "voc")) return null;
      const p = P(s);
      if (s.edu.stage === "voc") return null;
      const tutor = E.natMeanPC(s.iso) * 4;
      const can = s.fam.u > 0.45 || s.savings > tutor;
      return {
        title: `${p.exam2 || "졸업 시험"}이 다가와요`,
        body: `${p.sch.up} 마지막 해예요. ${p.exam2 || "졸업 시험"} 결과가 대학 진학을 좌우해요.`,
        facts: [
          fact(`대학 진학률(총취학률, ${s.sex === "m" ? "남" : "여"}): ${Math.round(W(s.iso, s.sex === "m" ? "SE.TER.ENRR.MA" : "SE.TER.ENRR.FE") || 0)}%`),
          fact(`지금 내 학업 수준: 또래 상위 ${Math.round(100 - s.st.smarts)}% 정도`, "게임 계산"),
        ],
        options: [
          { key: "grind", label: "잠을 줄이고 마지막까지 공부한다", hint: "점수↑ 건강·행복↓" },
          { key: "tutor", label: "학원·과외를 받는다", hint: can ? `약 ${money(s, tutor)} 들어요` : "집에서 감당하기 어려워요", disabled: !can },
          { key: "normal", label: "평소대로 준비한다", hint: "무리하지 않기" },
        ],
        ctx: { tutor },
      };
    },
    resolve(s, key, dec) {
      const p = P(s);
      let z = (s.st.smarts - 50) / 15 + R.normal(s, 0, 0.45);
      if (key === "grind") { z += 0.3; add(s, "health", -4); add(s, "happy", -8); }
      if (key === "tutor") { z += 0.3; if (s.fam.u <= 0.45) s.savings -= dec.ctx.tutor; }
      s.edu.rank = clamp(normCdf(z), 0.005, 0.999);
      s.edu.level = 3; s.edu.inSchool = false; s.edu.stage = null; s.edu.lastStage = "up";
      E.queue(s, "after_school", 1);
      return `${p.exam2 || "졸업 시험"} 결과: 전국 상위 ${Math.max(0.5, Math.round((1 - s.edu.rank) * 1000) / 10)}%. 고등학교를 졸업했어요.`;
    },
  };

  function admitThresholds(s) {
    const ter = clamp(Wp(s.iso, s.sex === "m" ? "SE.TER.ENRR.MA" : "SE.TER.ENRR.FE", 0.3), 0.02, 1.2);
    const grads = upperRate(s) * 0.85;
    const share = clamp(ter / Math.max(0.1, grads), 0.05, 0.92);
    return { any: 1 - share, elite: 0.97, med: Math.max(0.9, 1 - share * 0.12), ter };
  }

  DEC.after_school = {
    open(s) {
      const p = P(s);
      const voc = s.edu.lastStage === "voc";
      const r = s.edu.rank != null ? s.edu.rank : 0.3;
      const th = admitThresholds(s);
      const cost = uniCost(s);
      const pay = famCanPay(s, cost);
      const loans = isHIC(s);
      const scholar = r > 0.9;
      const ok = !voc && r >= th.any;
      const okElite = !voc && r >= th.elite;
      const army = P(s).army;
      const opts = [];
      if (okElite) opts.push({ key: "elite", label: `${p.elite}에 간다`, hint: "명문대, 학비·경쟁 모두 높아요" });
      opts.push({ key: "uni", label: `${p.sch.uni}에 간다`, hint: ok ? (pay ? `한 해 학비·생활비 약 ${money(s, cost)}` : loans ? "학자금 대출을 받아야 해요" : scholar ? "장학금을 노려볼 만해요" : "학비가 큰 부담이에요") : `점수가 모자라요 (상위 ${Math.round((1 - th.any) * 100)}% 안이어야)`, disabled: !ok });
      opts.push({ key: "college", label: `${p.sch.voc === "직업학교" ? "전문대·직업훈련" : "전문대·" + p.sch.voc}`, hint: "2년, 기술 자격" });
      if (exams.includes(s.iso) && !voc && !s.edu.retook) opts.push({ key: "retake", label: "1년 더 준비해서 다시 본다", hint: "재수, 점수가 오를 수도" });
      opts.push({ key: "work", label: "바로 일을 시작한다", hint: `청년 실업률 ${Math.round(uRate(s) * 100)}%` });
      if (army && s.sex === "m" && !s.army) opts.push({ key: "army", label: "군대부터 다녀온다", hint: `${army[0] >= 24 ? Math.round(army[0] / 12) + "년" : army[0] + "개월"} 복무` });
      if (s.fam.u > 0.88 || (r > 0.95 && !isHIC(s))) opts.push({ key: "abroad", label: "해외 대학으로 유학 간다", hint: s.fam.u > 0.88 ? "가족이 지원해줄 수 있어요" : "장학금이 필요해요" });
      return {
        title: "고등학교를 마친 다음",
        body: voc ? `${p.sch.voc}를 마쳤어요. 이제 어떻게 할까요?` : `시험 성적은 전국 상위 ${Math.max(0.5, Math.round((1 - r) * 1000) / 10)}%예요.`,
        facts: [
          fact(`${p.ko} 대학 진학률(총취학률): ${Math.round(th.ter * 100)}%`),
          fact(`청년(15~24세) 실업률: ${Math.round(uRate(s) * 100)}%`, "ILO·세계은행"),
          fact(`25세 이상 대졸자 비율: ${pct(Wp(s.iso, "SE.TER.CUAT.BA.ZS", 0.1))}`),
        ],
        options: opts,
        ctx: { r, cost, pay, loans, scholar },
      };
    },
    resolve(s, key, dec) {
      const p = P(s);
      const c = dec.ctx;
      if (key === "elite" || key === "uni") {
        let fund = "";
        if (!c.pay) {
          if (c.scholar && R.chance(s, 0.55)) fund = " 장학금을 받았어요.";
          else if (c.loans) { s.debt = (s.debt || 0) + c.cost * 4 * 0.6; s.savings -= c.cost * 4 * 0.6; fund = " 학자금 대출로 학비를 마련했어요."; }
          else { s.edu.partTime = true; fund = " 일을 하면서 다니기로 했어요. 졸업이 늦어질 수 있어요."; }
        }
        s.edu.elite = key === "elite";
        s.edu.inSchool = true; s.edu.stage = "uni_pick";
        E.queue(s, "major_pick", 0);
        return `${key === "elite" ? p.elite : p.sch.uni}에 합격했어요!${fund}`;
      }
      if (key === "college") {
        s.edu.inSchool = true; s.edu.stage = "college"; s.edu.end = s.age + 2;
        return "전문대·직업훈련 과정에 들어갔어요.";
      }
      if (key === "retake") {
        s.edu.retook = true; s.edu.stage = "retake"; s.edu.inSchool = true; s.edu.end = s.age + 1;
        add(s, "happy", -6);
        return "1년 더 공부하기로 했어요.";
      }
      if (key === "army") { E.startArmy(s); return "입대했어요."; }
      if (key === "abroad") return EV.goAbroadStudy(s, c);
      s.looking = true;
      return "일을 찾기 시작했어요.";
    },
  };

  DEC.major_pick = {
    open(s) {
      const r = s.edu.rank != null ? s.edu.rank : 0.5;
      const th = admitThresholds(s);
      const keys = ["eng", "med", "biz", "edu", "hum", "sci", "law", "art", "agr"];
      const opts = keys.map((k) => {
        const m = C.majors[k];
        const ok = k !== "med" || r >= th.med;
        const pro = m.w[0] + m.w[1] + m.w[2];
        return { key: k, label: m.ko, hint: ok ? `전문직·사무직으로 가는 비율이 ${pro > 0.7 ? "높아요" : pro > 0.5 ? "보통이에요" : "낮은 편이에요"}${m.years ? `, ${m.years}년 과정` : ""}` : `점수가 모자라요 (상위 ${Math.round((1 - th.med) * 100)}%)`, disabled: !ok };
      });
      return { title: "무엇을 전공할까", body: "전공에 따라 졸업 후 일자리가 달라져요.", facts: [fact("전공별 직업 비율은 ILO 직업 분포와 학력 조건으로 계산해요", "ILO")], options: opts };
    },
    resolve(s, key) {
      const m = C.majors[key];
      s.edu.major = key; s.edu.stage = "uni"; s.edu.end = s.age + (m.years || 4) + (s.edu.partTime ? 1 : 0);
      return `${m.ko}을 전공으로 골랐어요.`;
    },
  };

  DEC.grad_next = {
    open(s) {
      const p = P(s);
      const opts = [
        { key: "work", label: "취업 준비를 한다", hint: "전공을 살린 일자리 찾기" },
        { key: "master", label: "대학원(석사)에 간다", hint: "2년, 전문직 기회↑" },
      ];
      if (s.edu.level >= 6) opts[1] = { key: "phd", label: "박사 과정에 간다", hint: "4~6년, 연구자의 길" };
      const army = p.army;
      if (army && s.sex === "m" && !s.army) opts.push({ key: "army", label: "군 복무를 마친다", hint: `${army[0]}개월` });
      opts.push({ key: "abroad", label: "해외에서 일자리를 찾는다", hint: "비자가 관건" });
      return { title: s.edu.level >= 6 ? "석사를 마쳤어요" : "졸업했어요", body: `${C.majors[s.edu.major || "hum"].ko} 전공으로 졸업했어요.`, facts: [fact(`${p.ko} 실업률: ${(W(s.iso, "SL.UEM.TOTL.ZS") || 0).toFixed(1)}%`, "ILO")], options: opts };
    },
    resolve(s, key) {
      if (key === "master") { s.edu.inSchool = true; s.edu.stage = "master"; s.edu.end = s.age + 2; return "대학원에 들어갔어요."; }
      if (key === "phd") { s.edu.inSchool = true; s.edu.stage = "phd"; s.edu.end = s.age + 5; return "박사 과정을 시작했어요."; }
      if (key === "army") { E.startArmy(s); return "입대했어요."; }
      if (key === "abroad") { E.queue(s, "emigrate", 0, "work"); s.looking = true; return "해외 취업을 알아보기 시작했어요."; }
      s.looking = true;
      return "취업 준비를 시작했어요.";
    },
  };

  // schooling clock: stage ends -> next decision
  function schoolMonthly(s) {
    const e = s.edu;
    if (!e.inSchool || e.end == null || s.age < e.end) return;
    const st = e.stage;
    e.end = null;
    if (st === "up") { E.queue(s, "school_final", 0); e.end = null; return; }
    if (st === "voc") { e.level = 3; e.inSchool = false; e.lastStage = "voc"; e.stage = null; e.rank = 0.2; E.queue(s, "after_school", 0); log(s, `${P(s).sch.voc}를 졸업했어요.`, "edu"); return; }
    if (st === "retake") {
      const z = (s.st.smarts - 50) / 15 + R.normal(s, 0.25, 0.45);
      e.rank = clamp(normCdf(z), 0.005, 0.999); e.inSchool = false; e.stage = null;
      log(s, `다시 본 시험 결과: 전국 상위 ${Math.max(0.5, Math.round((1 - e.rank) * 1000) / 10)}%.`, "edu");
      E.queue(s, "after_school", 0); return;
    }
    if (st === "college") { e.level = 4; e.inSchool = false; e.stage = null; s.looking = true; log(s, "전문 과정을 마치고 자격을 땄어요. 일자리를 찾아요.", "edu"); return; }
    if (st === "uni") { e.level = 5; e.inSchool = false; e.stage = null; log(s, `${e.elite ? P(s).elite : "대학"}을 졸업했어요. 학사 학위를 받았어요.`, "edu"); add(s, "happy", 6); E.queue(s, "grad_next", 0); return; }
    if (st === "master") { e.level = 6; e.inSchool = false; e.stage = null; log(s, "석사 학위를 받았어요.", "edu"); E.queue(s, "grad_next", 0); return; }
    if (st === "phd") { e.level = 7; e.inSchool = false; e.stage = null; log(s, "박사 학위를 받았어요.", "edu"); s.looking = true; s.lookPrefer = { 2: 4 }; return; }
  }

  EV.goAbroadStudy = function (s, c) {
    const dest = R.pick(s, ["USA", "GBR", "AUS", "CAN", "DEU", "JPN"].filter((x) => x !== s.iso));
    const ok = R.chance(s, s.fam.u > 0.88 ? 0.8 : 0.35);
    if (!ok) { s.looking = true; return `${C.countries[dest][0]} 유학을 준비했지만 비자와 돈 문제로 무산됐어요. 일을 찾아요.`; }
    EV.moveTo(s, dest, "study");
    s.edu.inSchool = true; s.edu.stage = "uni"; s.edu.major = s.edu.major || R.pick(s, ["eng", "biz", "sci"]); s.edu.end = s.age + 4;
    return `${C.countries[dest][0]}의 대학에 입학했어요. 낯선 나라에서의 생활이 시작됐어요.`;
  };

  // ---------- military ----------
  E.startArmy = function (s) {
    const a = P(s).army;
    const months = a ? a[0] : 18;
    s.army = { active: true, end: s.age + months / 12, months };
    if (s.job) { s.lastJob = s.job; s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) }); s.job = null; }
    s.looking = false;
    if (s.edu.inSchool && s.edu.stage === "uni") { s.edu.uniLeft = Math.max(0.5, s.edu.end - s.age); s.edu.stage = "uni_paused"; s.edu.end = null; }
    s.edu.inSchool = false;
    log(s, `${P(s).ko} 군에 입대했어요. ${months >= 24 ? Math.round(months / 12) + "년" : months + "개월"} 동안 복무해요.`, "army");
  };
  DEC.army_call = {
    open(s) {
      const a = P(s).army;
      if (!a || s.army || (s.sex === "f" && !a[3])) return null;
      const late = s.age >= a[2] - 1;
      const lottery = P(s).armyLottery;
      const opts = [{ key: "now", label: "지금 입대한다", hint: `${a[0]}개월` }];
      if (!late && (s.edu.inSchool || s.job)) opts.push({ key: "later", label: "미룬다", hint: `${a[2]}살 전까지는 가야 해요` });
      if (P(s).war) opts.push({ key: "dodge", label: "징집을 피해 숨는다", hint: "발각되면 처벌, 가족도 곤란" });
      return {
        title: lottery ? "징병 추첨" : "입영 통지서가 왔어요",
        body: `${P(s).ko}에서는 ${a[3] ? "남녀 모두" : "남성은"} ${a[1]}~${a[2]}살 사이에 병역 의무가 있어요.${P(s).war ? " 지금은 전쟁 중이에요." : ""}`,
        facts: [fact(`복무 기간: ${a[0]}개월`, "각국 병역법")],
        options: opts,
      };
    },
    resolve(s, key) {
      const p = P(s);
      if (key === "later") { s.armyDefer = s.year; return "입대를 미뤘어요."; }
      if (s.edu.stage === "uni_paused" && key !== "now") { s.edu.stage = "uni"; s.edu.inSchool = true; s.edu.end = s.age + (s.edu.uniLeft || 2); }
      if (key === "dodge") {
        if (R.chance(s, 0.3)) { add(s, "happy", -15); s.savings -= monthly(s) * 3; E.startArmy(s); return "숨어 지내다 붙잡혀 결국 입대했어요."; }
        add(s, "happy", -10); s.armyDodged = true; s.army = { active: false, done: true, dodged: true };
        return "징집을 피해 숨어 지내기로 했어요. 마음 편할 날이 없어요.";
      }
      if (p.armyLottery && !R.chance(s, p.armyLottery)) { s.army = { active: false, done: true, exempt: true }; return "추첨에서 빠졌어요. 복무하지 않아도 돼요."; }
      E.startArmy(s);
      return "입대했어요.";
    },
  };
  function armyMonthly(s) {
    if (!s.army || !s.army.active) return;
    if (R.chance(s, 0.06)) log(s, R.pick(s, ["혹한기 훈련을 받았어요.", "첫 휴가를 나왔어요.", "선임과 부딪혀 힘든 한 달이었어요.", "동기들과 꽤 친해졌어요.", "야간 경계 근무가 길었어요."]), "army");
    if (s.age >= s.army.end) {
      s.army.active = false; s.army.done = true;
      add(s, "social", 4); add(s, "health", 2);
      log(s, "만기 전역했어요.", "army");
      if (s.lastJob) { s.looking = true; } else if (s.edu.stage === "uni_paused") { s.edu.inSchool = true; s.edu.stage = "uni"; s.edu.end = s.age + (s.edu.uniLeft || 2); }
      else if (s.edu.level >= 3 && !s.edu.inSchool) s.looking = true;
    }
  }

  // ---------- work ----------
  DEC.job_offer = {
    open(s, arg) {
      const n = R.chance(s, 0.5) ? 3 : 2;
      const offers = [];
      for (let i = 0; i < n; i++) {
        const o = E.makeOffer(s, { major: s.edu.major && s.edu.level >= 5 ? s.edu.major : null, prefer: s.lookPrefer, migrant: s.migrant ? 0.78 : null });
        if (!offers.some((x) => x.title === o.title)) offers.push(o);
      }
      const p = P(s);
      const opts = offers.map((o, i) => ({
        key: "o" + i,
        label: `${o.title}`,
        hint: `${C.iscoName[o.isco]} · 월 ${money(s, o.pay)} · ${o.informal ? "비공식(계약서·연금 없음)" : o.self ? "자영업" : "정규직"}`,
      }));
      opts.push({ key: "wait", label: "더 좋은 자리를 기다린다", hint: "한동안 수입 없음" });
      const startCap = E.natMeanPC(s.iso) * 8;
      if (s.age >= 17) opts.push({ key: "biz", label: "내 장사·사업을 시작한다", hint: s.savings >= startCap ? `밑천 약 ${money(s, startCap)}` : "밑천이 부족해 빚을 내야 해요" });
      return {
        title: "일자리 제안",
        body: `${s.teenWork && s.age < 18 ? "어린 나이지만 " : ""}일할 곳을 찾았어요.`,
        facts: [
          fact(`${p.ko} 비농업 일자리 중 비공식 고용: ${Math.round(W(s.iso, "SL.ISV.IFRM.ZS") || (isHIC(s) ? 12 : 60))}%`, "ILO·세계은행"),
          fact(`평균 월급(임금근로자): ${money(s, E.meanEarnMonth(s.iso))}`, "ILO"),
        ],
        options: opts,
        ctx: { offers, startCap },
      };
    },
    resolve(s, key, dec) {
      if (key === "wait") { add(s, "happy", -2); s.looking = true; s.waitBonus = (s.waitBonus || 0) + 1; return "조금 더 찾아보기로 했어요."; }
      if (key === "biz") return EV.startBusiness(s, dec.ctx.startCap);
      const o = dec.ctx.offers[+key.slice(1)];
      EV.takeJob(s, o);
      return `${o.title}(으)로 일하기 시작했어요. 월 ${money(s, o.pay)}.`;
    },
  };
  EV.takeJob = function (s, o) {
    if (s.job) s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) });
    s.job = Object.assign({}, o, { since: s.age, perf: 0 });
    s.job.moto = /오토바이|오카다|보다보다|오젝|쎄옴|라이더|배달/.test(o.title);
    s.looking = false; s.waitBonus = 0; s.lookPrefer = null;
    if (s.age >= 17 || s.partner) s.indep = true;
    add(s, "happy", 4);
  };
  EV.startBusiness = function (s, cap) {
    if (s.savings < cap) { s.debt = (s.debt || 0) + (cap - Math.max(0, s.savings)); }
    s.savings -= cap;
    const kind = s.edu.level >= 5 && isHIC(s) ? R.pick(s, ["작은 온라인 쇼핑몰", "카페", "디자인 스튜디오", "앱 개발 회사"]) : R.pick(s, ["작은 식당", "구멍가게", "옷 가게", "휴대폰 수리점", "미용실", "운송업"]);
    const skill = (s.st.smarts - 50) / 100 + (s.st.social - 50) / 100;
    s.business = { kind, monthly: E.meanEarnMonth(s.iso) * clamp(0.7 + skill + R.normal(s, 0, 0.3), 0.1, 3), age: 0, cap };
    if (s.job) { s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) }); s.job = null; }
    s.looking = false; s.indep = true;
    s.jobsHeld.push({ title: kind + " 운영", from: Math.floor(s.age), to: null, biz: true });
    return `${kind}을(를) 열었어요. 이제 내 가게예요.`;
  };
  function businessYearly(s) {
    const b = s.business;
    if (!b) return;
    b.age++;
    const fail = b.age === 1 ? 0.2 : b.age <= 5 ? 0.1 : 0.05;
    const z = (s.st.smarts - 50) / 120 + (s.focus === "work" ? 0.04 : 0) - (s.recession ? 0.05 : 0);
    if (R.chance(s, clamp(fail - z, 0.02, 0.4))) {
      log(s, `${b.kind}이(가) 문을 닫았어요. ${b.age}년 만이에요.`, "money");
      add(s, "happy", -12);
      const last = s.jobsHeld.find((j) => j.biz && j.to == null); if (last) last.to = Math.floor(s.age);
      s.business = null; s.looking = true;
      return;
    }
    const g = R.normal(s, 0.03 + z, 0.18);
    b.monthly *= Math.exp(g);
    if (g > 0.25) log(s, `${b.kind} 장사가 잘 돼요. 매출이 크게 늘었어요.`, "money");
    if (g < -0.2) log(s, `${b.kind} 손님이 눈에 띄게 줄었어요.`, "money");
  }

  function jobMonthly(s) {
    if (s.looking && !s.pending && !(s.army && s.army.active)) {
      const p = clamp(0.42 - 1.4 * uRate(s), 0.06, 0.6) * (s.edu.level >= 5 ? 1.1 : 1) * (1 + (s.st.social - 50) / 150) * (1 + 0.15 * (s.waitBonus || 0));
      if (R.chance(s, p)) E.queue(s, "job_offer", 0);
      else if (R.chance(s, 0.08)) { log(s, R.pick(s, ["이력서를 또 냈지만 연락이 없어요.", "면접에서 떨어졌어요.", "일자리 공고를 찾아 하루 종일 돌아다녔어요."]), "work"); add(s, "happy", -1); }
    }
  }
  function jobYearly(s) {
    if (!s.job || s.retired) return;
    const j = s.job;
    j.perf = (j.perf || 0) + clamp(0.015 + (s.focus === "work" ? 0.03 : 0) + (s.st.smarts - 50) / 2000 + R.normal(s, 0, 0.02), -0.05, 0.08);
    const lay = uRate(s) * 0.5 * (j.informal ? 1.6 : 1) * (s.recession ? 2 : 1) * (s.focus === "work" ? 0.7 : 1);
    if (R.chance(s, clamp(lay, 0.005, 0.25))) {
      log(s, j.informal ? `${j.title} 일이 끊겼어요.` : `회사 사정으로 ${j.title} 자리를 잃었어요.`, "work");
      s.jobsHeld.push({ title: j.title, from: Math.floor(j.since), to: Math.floor(s.age) });
      s.job = null; s.looking = true; add(s, "happy", -10);
      return;
    }
    if ([2, 3, 4, 5, 7, 8].includes(j.isco) && s.exp >= 5 && R.chance(s, 0.04 + (s.focus === "work" ? 0.05 : 0) + (s.st.social - 50) / 800)) E.queue(s, "promotion", R.int(s, 1, 11));
    else if (R.chance(s, 0.07 + (s.st.social - 50) / 1000)) E.queue(s, "job_switch", R.int(s, 1, 11));
    if (s.focus === "work" && s.st.happy < 35 && R.chance(s, 0.3)) E.queue(s, "burnout", R.int(s, 1, 6));
  }
  DEC.promotion = {
    open(s) {
      if (!s.job) return null;
      return {
        title: "승진 제안", body: `${s.job.title}로 일한 지 ${Math.floor(s.age - s.job.since)}년. 관리자 자리를 제안받았어요.`,
        facts: [fact(`관리자 직군 임금은 평균의 약 ${(D.c[s.iso].earn[1] || 2).toFixed(1)}배`, "ILO")],
        options: [
          { key: "yes", label: "맡는다", hint: "월급↑ 스트레스↑" },
          { key: "no", label: "지금 자리가 좋다", hint: "여유 유지" },
        ],
      };
    },
    resolve(s, key) {
      if (key === "no") { add(s, "happy", 2); return "승진 제안을 사양했어요."; }
      const old = s.job.title;
      s.job.isco = 1; s.job.title = old.includes("팀장") ? "부서장" : old + " 팀장"; s.job.perf += 0.05;
      add(s, "health", -2); add(s, "happy", 3);
      return `${s.job.title}로 승진했어요.`;
    },
  };
  DEC.job_switch = {
    open(s) {
      if (!s.job) return null;
      const o = E.makeOffer(s, { prefer: { [s.job.isco]: 3 }, major: s.edu.major });
      if (o.pay < s.job.pay * 1.05) o.pay = s.job.pay * (1.1 + R.f(s) * 0.3);
      return {
        title: "다른 곳에서 연락이 왔어요", body: `${o.title} 자리예요. 월 ${money(s, o.pay)} (지금 ${money(s, s.job.pay)}).`,
        facts: [], ctx: { o },
        options: [
          { key: "move", label: "옮긴다", hint: o.informal ? "비공식 자리예요" : "새 환경" },
          { key: "stay", label: "지금 회사에 남는다", hint: "익숙함" },
        ],
      };
    },
    resolve(s, key, dec) {
      if (key === "stay") return "지금 자리에 남기로 했어요.";
      const o = dec.ctx.o;
      EV.takeJob(s, o);
      s.job.pay = o.pay; s.job.indiv *= o.pay / Math.max(1, E.payFor(s, s.job));
      return `${o.title}(으)로 옮겼어요.`;
    },
  };
  DEC.burnout = {
    open(s) {
      if (!s.job) return null;
      return {
        title: "번아웃", body: "아침에 눈을 뜨는 게 힘들어요. 일이 손에 잡히지 않아요.",
        facts: [], options: [
          { key: "rest", label: "몇 달 쉰다", hint: "수입은 줄지만 회복" },
          { key: "push", label: "버틴다", hint: "건강·행복↓" },
          { key: "quit", label: "그만둔다", hint: "새 출발" },
        ],
      };
    },
    resolve(s, key) {
      if (key === "rest") { s.savings -= s.job.pay * 2; add(s, "happy", 15); add(s, "health", 5); s.focus = "balance"; return "석 달을 쉬었어요. 조금 숨이 쉬어져요."; }
      if (key === "push") { add(s, "health", -6); add(s, "happy", -5); return "꾹 참고 버티는 중이에요."; }
      s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) });
      s.job = null; s.looking = true; add(s, "happy", 10);
      return "사표를 냈어요.";
    },
  };

  // ---------- love, marriage, children ----------
  function single(s) { return !s.partner || !s.partner.alive || s.partner.status === "none"; }
  DEC.teen_marriage = {
    open(s) {
      if (s.sex !== "f" || !single(s)) return null;
      const m18 = Wp(s.iso, "SP.M18.2024.FE.ZS", 0.05);
      const groom = { name: E.nameFor(s, s.iso, "m"), age: Math.floor(s.age) + clamp(Math.round(R.normal(s, 9, 4)), 3, 30), sex: "m" };
      return {
        title: "집안에서 혼처를 정했어요",
        body: `부모님이 ${groom.age}살 ${groom.name}와(과)의 결혼을 정하려 해요. 나는 ${Math.floor(s.age)}살이에요.`,
        facts: [fact(`${P(s).ko} 20~24세 여성 중 18살 전에 결혼한 비율: ${pct(m18)}`, "UNICEF·세계은행"), fact(`15살 전에 결혼한 비율: ${pct(Wp(s.iso, "SP.M15.2024.FE.ZS", 0.01))}`, "UNICEF·세계은행")],
        ctx: { groom },
        options: [
          { key: "accept", label: "받아들인다", hint: "가족의 뜻대로" },
          { key: "delay", label: "학교를 마칠 때까지 미뤄달라고 설득한다", hint: "부모님 마음에 달렸어요" },
          { key: "run", label: "집을 떠난다", hint: "혼자 도시로, 위험해요" },
        ],
      };
    },
    resolve(s, key, dec) {
      const g = dec.ctx.groom;
      if (key === "accept" || (key === "delay" && !R.chance(s, clamp(0.3 + (s.st.social - 50) / 150 + (s.fam.mother.edu >= 3 ? 0.15 : 0), 0.08, 0.8)))) {
        s.partner = { name: g.name, age: g.age, status: "married", since: s.age, alive: true, arranged: true, sex: "m" };
        E.partnerJob(s);
        s.indep = true;
        if (s.edu.inSchool && R.chance(s, 0.75)) { s.edu.inSchool = false; s.edu.stage = null; }
        add(s, "happy", key === "accept" ? -4 : -10);
        return key === "accept" ? `${g.name}와(과) 결혼했어요.` : `설득은 통하지 않았어요. ${g.name}와(과) 결혼했어요.`;
      }
      if (key === "delay") { s.teenDelay = s.year; add(s, "happy", 3); return "부모님이 혼사를 미뤄주셨어요."; }
      // leaving home
      add(s, "happy", -6); add(s, "social", -10);
      s.urban = true; s.place = R.pick(s, P(s).cities); s.edu.inSchool = false; s.edu.stage = null;
      s.indep = true; s.looking = true; s.savings = Math.max(0, s.savings);
      if (R.chance(s, 0.15)) { add(s, "health", -12); add(s, "happy", -10); return `${s.place}로 떠났어요. 혼자 지내는 동안 위험한 일을 겪었어요.`; }
      return `짐을 싸서 ${s.place}로 떠났어요. 이제 혼자 살아가야 해요.`;
    },
  };
  DEC.romance = {
    open(s) {
      if (!single(s)) return null;
      const psex = s.sex === "m" ? "f" : "m";
      const who = { name: E.nameFor(s, s.iso, psex), age: Math.floor(s.age) + clamp(Math.round(R.normal(s, s.sex === "m" ? -2 : 2, 3)), -8, 12), sex: psex };
      const how = R.pick(s, s.edu.inSchool ? ["같은 학교", "친구 모임", "동아리"] : s.job ? ["직장", "친구 소개", "동네", "모임"] : ["친구 소개", "동네", "종교 모임", "온라인"]);
      return {
        title: "마음이 가는 사람",
        body: `${how}에서 만난 ${who.age}살 ${who.name}와(과) 자꾸 눈이 마주쳐요.`,
        facts: [], ctx: { who },
        options: [
          { key: "date", label: "다가가 본다", hint: "연애 시작" },
          { key: "no", label: "지금은 내 일에 집중한다", hint: "" },
        ],
      };
    },
    resolve(s, key, dec) {
      if (key === "no") return "마음을 접었어요.";
      if (!R.chance(s, clamp(0.45 + (s.st.social - 50) / 100, 0.15, 0.85))) { add(s, "happy", -5); return `${dec.ctx.who.name}에게 마음을 전했지만 거절당했어요.`; }
      s.partner = Object.assign({}, dec.ctx.who, { status: "dating", since: s.age, alive: true });
      add(s, "happy", 8);
      return `${dec.ctx.who.name}와(과) 사귀기 시작했어요.`;
    },
  };
  function weddingCost(s) {
    const k = { SAS: 8, MEA: 7, SSF: 4, EAS: 6, ECS: 3, LCN: 3, NAC: 3 }[D.c[s.iso].r] || 4;
    return E.natMeanPC(s.iso) * k * (s.iso === "KOR" ? 2 : 1);
  }
  DEC.proposal = {
    open(s) {
      if (!s.partner || s.partner.status !== "dating" || !s.partner.alive) return null;
      const cost = weddingCost(s);
      return {
        title: "결혼 이야기", body: `${s.partner.name}와(과) 만난 지 ${Math.max(1, Math.round(s.age - s.partner.since))}년. 결혼 이야기가 나왔어요.`,
        facts: [fact(`${P(s).ko}의 평균 초혼 연령: 남 ${P(s).smam[0]}세, 여 ${P(s).smam[1]}세`, "UN 세계결혼데이터"), fact(`결혼 비용 대략 ${money(s, cost)}`, "게임 추정")],
        ctx: { cost },
        options: [
          { key: "marry", label: "결혼한다", hint: "" },
          { key: "wait", label: "조금 더 만나본다", hint: "" },
          { key: "break", label: "헤어진다", hint: "" },
        ],
      };
    },
    resolve(s, key, dec) {
      if (key === "wait") return "결혼은 조금 더 생각해보기로 했어요.";
      if (key === "break") { s.partner = null; add(s, "happy", -10); return "헤어졌어요."; }
      EV.marry(s, dec.ctx.cost);
      return `${s.partner.name}와(과) 결혼했어요!`;
    },
  };
  EV.marry = function (s, cost) {
    s.partner.status = "married"; s.partner.since = s.age;
    E.partnerJob(s);
    s.indep = true;
    s.savings -= cost * (s.fam.u > 0.6 ? 0.4 : 0.7);
    add(s, "happy", 12);
    s.kidPlan = s.kidPlan || null;
  };
  DEC.arranged = {
    open(s) {
      if (!single(s)) return null;
      const psex = s.sex === "m" ? "f" : "m";
      const who = { name: E.nameFor(s, s.iso, psex), age: Math.floor(s.age) + (s.sex === "m" ? -R.int(s, 2, 7) : R.int(s, 2, 8)), sex: psex };
      return {
        title: "중매가 들어왔어요", body: `집안 어른들이 ${who.age}살 ${who.name}을(를) 배우자로 소개했어요. 집안끼리는 이미 이야기가 오갔어요.`,
        facts: [fact(`${P(s).ko}에서는 결혼의 상당수가 집안끼리 정해져요 (대략 ${Math.round((P(s).arranged || 0) * 100)}%)`, "각국 가족 조사")],
        ctx: { who, cost: weddingCost(s) },
        options: [
          { key: "yes", label: "받아들인다", hint: "" },
          { key: "meet", label: "몇 번 만나보고 정한다", hint: "" },
          { key: "no", label: "내가 고른 사람과 하겠다", hint: "집안과 갈등" },
        ],
      };
    },
    resolve(s, key, dec) {
      if (key === "no") { add(s, "happy", -2); s.arrangedNo = (s.arrangedNo || 0) + 1; return "중매를 거절했어요. 어른들 눈치가 보여요."; }
      if (key === "meet" && R.chance(s, 0.35)) return `${dec.ctx.who.name}와(과) 몇 번 만났지만 서로 맞지 않았어요.`;
      s.partner = Object.assign({}, dec.ctx.who, { status: "dating", since: s.age, alive: true, arranged: true });
      EV.marry(s, dec.ctx.cost);
      return `${dec.ctx.who.name}와(과) 결혼했어요.`;
    },
  };
  function femaleAge(s) {
    if (!s.partner || s.partner.status !== "married" || !s.partner.alive) return null;
    return s.sex === "f" ? s.age : s.partner.age;
  }
  function fecund(a) {
    if (a < 15 || a >= 48) return 0;
    if (a <= 30) return 0.85; if (a <= 35) return 0.75; if (a <= 38) return 0.55; if (a <= 41) return 0.35; if (a <= 44) return 0.12; return 0.03;
  }
  DEC.kids = {
    open(s) {
      const fa = femaleAge(s);
      if (fa == null || fa >= 46 || s.pregnant) return null;
      const n = s.kids.length;
      const tfr = D.c[s.iso].tfr[0];
      const mmr = W(s.iso, "SH.STA.MMRT") || 100;
      const facts = [fact(`${P(s).ko} 여성 한 명이 평생 낳는 아이 수(합계출산율): ${tfr.toFixed(2)}명`, "UN WPP 2024")];
      if (s.sex === "f" || mmr > 100) facts.push(fact(`출산 10만 건당 산모 사망: ${Math.round(mmr)}명`, "WHO·세계은행"));
      facts.push(fact(`가족계획 수요 중 현대적 피임으로 충족되는 비율: ${Math.round(W(s.iso, "SH.FPL.SATM.ZS") || 70)}%`, "UN·세계은행"));
      return {
        title: n ? `${n + 1}번째 아이?` : "아이를 가질까요",
        body: n ? `아이가 ${n}명 있어요.` : `${s.partner.name}와(과) 아이 이야기를 했어요.`,
        facts,
        options: [
          { key: "try", label: "아이를 갖고 싶다", hint: "" },
          { key: "wait", label: "아직은 아니다", hint: "" },
          { key: "stop", label: n ? "이제 그만 낳는다" : "아이 없이 산다", hint: "" },
        ],
      };
    },
    resolve(s, key) {
      s.kidPlan = key; s.kidAsked = s.age;
      return { try: "아이를 갖기로 했어요.", wait: "아이는 조금 뒤로 미루기로 했어요.", stop: s.kids.length ? "아이는 이만 낳기로 했어요." : "아이 없이 살기로 했어요." }[key];
    },
  };
  function kidsMonthly(s) {
    const fa = femaleAge(s);
    if (s.pregnant) {
      if (s.age >= s.pregnant.due) EV.birth(s);
      return;
    }
    if (fa == null) return;
    const f = fecund(fa);
    if (!f) return;
    const sat = clamp((W(s.iso, "SH.FPL.SATM.ZS") || 70) / 100, 0.1, 0.95);
    let annual;
    if (s.kidPlan === "try") annual = f;
    else annual = f * ((1 - sat) * 0.3 + sat * 0.03) * (s.kidPlan === "stop" ? 0.7 : 1);
    if (!s.kidPlan) annual = f * 0.25; // newly married, no plan yet
    if (R.chance(s, 1 - Math.pow(1 - annual, 1 / 12))) {
      s.pregnant = { due: s.age + 0.75, planned: s.kidPlan === "try" };
      log(s, s.sex === "f" ? `임신했어요${s.kidPlan === "try" ? "!" : ". 계획에 없던 일이에요."}` : `${s.partner.name}가 임신했어요${s.kidPlan === "try" ? "!" : ". 계획에 없던 일이에요."}`, "family");
    }
  }
  EV.birth = function (s) {
    s.pregnant = null;
    const fa = femaleAge(s) || 30;
    const u = famU(s);
    let mm = (W(s.iso, "SH.STA.MMRT") || 100) / 1e5;
    mm *= (fa < 18 ? 1.6 : fa > 35 ? 1.5 : 1) * Math.exp(-1.2 * (u - 0.5)) * (s.urban ? 0.8 : 1.2);
    const sexKid = R.chance(s, 0.512) ? "m" : "f";
    const kid = { name: E.nameFor(s, s.iso, sexKid, s.famName || undefined), sex: sexKid, born: s.year, alive: true };
    s.kids.push(kid);
    s.kidPlan = "wait"; s.kidAsked = s.age;
    add(s, "happy", 14);
    log(s, `${kid.name}가 태어났어요. ${sexKid === "m" ? "아들" : "딸"}이에요.`, "family");
    if (R.chance(s, mm)) {
      if (s.sex === "f") { E.die(s, "maternal"); return; }
      s.partner.alive = false;
      log(s, `${s.partner.name}가 출산 중 합병증으로 세상을 떠났어요.`, "loss");
      add(s, "happy", -30);
    }
    if (s.sex === "f" && s.job && !s.job.self && R.chance(s, 0.5)) E.queue(s, "after_birth", 1);
  };
  DEC.after_birth = {
    open(s) {
      if (!s.job) return null;
      return {
        title: "육아와 일", body: `${s.kids[s.kids.length - 1].name}를 돌봐야 해요. ${s.job.title} 일은 어떻게 할까요?`,
        facts: [fact(`${P(s).ko} 여성 경제활동참가율: ${Math.round(W(s.iso, "SL.TLF.CACT.FE.ZS") || 50)}%`, "ILO")],
        options: [
          { key: "keep", label: "일을 계속한다", hint: "" },
          { key: "pause", label: "몇 년 쉰다", hint: "경력 단절 위험" },
        ],
      };
    },
    resolve(s, key) {
      if (key === "keep") { add(s, "health", -2); return "아이를 맡기고 일을 계속하기로 했어요."; }
      s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) });
      s.job = null; s.careBreak = s.age + 3;
      return "일을 쉬고 아이를 돌보기로 했어요.";
    },
  };
  DEC.marriage_trouble = {
    open(s) {
      if (!s.partner || s.partner.status !== "married" || !s.partner.alive) return null;
      return {
        title: "부부 사이가 차가워졌어요", body: `${s.partner.name}와(과) 말다툼이 잦아졌어요.`,
        facts: [], options: [
          { key: "work", label: "대화하고 노력한다", hint: "" },
          { key: "divorce", label: "이혼한다", hint: "" },
          { key: "endure", label: "참고 산다", hint: "" },
        ],
      };
    },
    resolve(s, key) {
      if (key === "work") { if (R.chance(s, 0.6 + (s.st.social - 50) / 200)) { add(s, "happy", 5); return "많이 이야기했어요. 다시 가까워졌어요."; } add(s, "happy", -4); return "노력했지만 마음의 거리는 그대로예요."; }
      if (key === "endure") { add(s, "happy", -6); return "그냥 참고 지내기로 했어요."; }
      s.partner = null; s.divorced = (s.divorced || 0) + 1; add(s, "happy", -8); s.savings *= 0.6;
      return "이혼했어요.";
    },
  };

  // ---------- health ----------
  const CURE = { tb: 0.85, malaria: 0.95, resp_inf: 0.9, diarrhea: 0.95, infect: 0.8, nutrition: 0.9 };
  const CHRONIC = ["diabetes", "ihd", "copd", "kidney", "hiv", "dementia", "neuro", "cvd_other", "cirrhosis", "stroke", "resp_other", "alcohol", "drugs"];
  const TREAT_COST = { tb: 1.5, hiv: 0.6, malaria: 0.3, resp_inf: 0.6, diarrhea: 0.2, infect: 1, nutrition: 0.5, diabetes: 3, ihd: 10, stroke: 8, cvd_other: 5, copd: 4, kidney: 10, cirrhosis: 6, dementia: 6, neuro: 4, other: 3, digest: 3, alcohol: 2, drugs: 2, resp_other: 2 };
  DEC.health_scare = {
    open(s, arg) {
      const c = arg;
      const name = C.causes[c] || "병";
      const ca = c.startsWith("ca_") || c === "leukemia";
      const oop = clamp((W(s.iso, "SH.XPD.OOPC.CH.ZS") || 40) / 100, 0.05, 0.9);
      const uhc = W(s.iso, "SH.UHC.SRVS.CV.XD") || (isHIC(s) ? 80 : 50);
      const full = E.natMeanPC(s.iso) * (ca ? 18 : TREAT_COST[c] || 3) * (oop + 0.1) * (s.job && !s.job.informal ? 0.8 : 1.15);
      const access = clamp(uhc / 100 + (s.urban ? 0.1 : -0.1), 0.15, 0.98);
      const can = s.savings + monthly(s) * 3 > full;
      const facts = [
        fact(`의료비 중 환자가 직접 내는 비율: ${Math.round(oop * 100)}%`, "WHO·세계은행"),
        fact(`보편적 의료보장 지수: ${Math.round(uhc)}/100`, "WHO·세계은행"),
      ];
      return {
        title: `${name} 진단`,
        body: ca ? `몸이 이상해 병원에 갔더니 ${name}이라고 해요.` : `${name} 증상이 나타났어요.`,
        facts, ctx: { c, full, access, ca },
        options: [
          { key: "full", label: "큰 병원에서 제대로 치료받는다", hint: `약 ${money(s, full)}${can ? "" : " (빚을 져야 해요)"}` },
          { key: "cheap", label: "가까운 보건소·약국에서 해결한다", hint: `약 ${money(s, full * 0.2)}` },
          { key: "trad", label: "전통 치료나 기도에 의지한다", hint: "돈은 거의 안 들어요" },
          { key: "none", label: "참고 지낸다", hint: "" },
        ],
      };
    },
    resolve(s, key, dec) {
      const { c, full, access, ca } = dec.ctx;
      const name = C.causes[c] || "병";
      const inc = clamp((D.c[s.iso].gk - 2000) / 60000, 0, 1);
      if (key === "full") {
        s.savings -= full;
        if (!R.chance(s, access)) { s.cond[c] = { treated: false, since: s.age }; return `치료를 받으려 했지만 ${s.urban ? "대기가 너무 길었어요" : "근처에 제대로 된 병원이 없었어요"}. ${name}은 그대로예요.`; }
        const cure = ca ? 0.15 + 0.55 * inc : CURE[c] || 0;
        if (R.chance(s, cure)) { delete s.cond[c]; add(s, "health", 6); return `치료가 잘 됐어요. ${name}을(를) 이겨냈어요.`; }
        s.cond[c] = { treated: true, since: s.age };
        if (CHRONIC.includes(c)) s.chronicCost = (s.chronicCost || 0) + full * 0.03;
        add(s, "health", 2);
        return CHRONIC.includes(c) ? `${name}을(를) 꾸준히 관리하며 지내야 해요.` : `치료를 받았지만 완전히 낫지는 않았어요.`;
      }
      if (key === "cheap") {
        s.savings -= full * 0.2;
        const cure = (CURE[c] || 0) * 0.55;
        if (R.chance(s, cure)) { delete s.cond[c]; return `약을 먹고 나았어요.`; }
        s.cond[c] = { treated: R.chance(s, 0.35), since: s.age };
        return `약을 먹었지만 ${name}은(는) 남아 있어요.`;
      }
      if (R.chance(s, (CURE[c] || 0) * 0.25)) { delete s.cond[c]; return "다행히 저절로 나았어요."; }
      s.cond[c] = { treated: false, since: s.age };
      add(s, "health", -4);
      return `${name}을(를) 그대로 안고 지내요.`;
    },
  };
  DEC.mental_low = {
    open(s) {
      return {
        title: "마음이 많이 힘든 시기", body: "몇 달째 아무것도 즐겁지 않아요. 잠도 잘 오지 않아요.",
        facts: [fact("실제로 이런 마음이 든다면 혼자 견디지 않아도 돼요. 한국에서는 자살예방상담전화 109로 언제든 이야기할 수 있어요.", "안내")],
        options: [
          { key: "help", label: "상담·치료를 받는다", hint: isHIC(s) ? "" : "상담받을 곳이 드물어요" },
          { key: "talk", label: "가까운 사람에게 털어놓는다", hint: "" },
          { key: "alone", label: "혼자 버틴다", hint: "" },
        ],
      };
    },
    resolve(s, key) {
      if (key === "help") { s.savings -= E.natMeanPC(s.iso) * 1.5; add(s, "happy", R.chance(s, isHIC(s) ? 0.75 : 0.45) ? 20 : 8); return "도움을 받기 시작했어요. 조금씩 나아지고 있어요."; }
      if (key === "talk") { add(s, "happy", 8 + (s.st.social - 50) / 5); add(s, "social", 3); return "마음을 털어놓았어요. 생각보다 나를 걱정하는 사람이 많았어요."; }
      add(s, "happy", -3);
      return "혼자 버티는 중이에요.";
    },
  };
  DEC.smoke = {
    open(s) {
      const prev = Wp(s.iso, s.sex === "m" ? "SH.PRV.SMOK.MA" : "SH.PRV.SMOK.FE", 0.2);
      return {
        title: "담배 한 대", body: "친구들이 담배를 권해요.",
        facts: [fact(`${P(s).ko} 15세 이상 ${s.sex === "m" ? "남성" : "여성"} 흡연율: ${pct(prev)}`, "WHO·세계은행")],
        options: [
          { key: "yes", label: "피워본다", hint: "" },
          { key: "no", label: "사양한다", hint: "" },
        ],
      };
    },
    resolve(s, key) {
      if (key === "no") return "담배를 거절했어요.";
      if (R.chance(s, 0.55)) { s.habit.smoke = true; return "어느새 담배가 습관이 됐어요."; }
      return "몇 번 피우다 말았어요.";
    },
  };
  DEC.quit_smoke = {
    open(s) {
      if (!s.habit.smoke) return null;
      return {
        title: "담배를 끊을까", body: "숨이 차고 기침이 잦아졌어요.",
        facts: [fact("흡연자는 폐암 위험이 비흡연자의 약 10배예요", "WHO")],
        options: [
          { key: "quit", label: "끊는다", hint: "한 번에 성공하는 사람은 많지 않아요" },
          { key: "keep", label: "그냥 피운다", hint: "" },
        ],
      };
    },
    resolve(s, key) {
      if (key === "keep") return "계속 피우기로 했어요.";
      if (R.chance(s, 0.3 + (s.focus === "health" ? 0.15 : 0))) { s.habit.smoke = false; s.habit.quitAt = s.age; add(s, "health", 3); return "담배를 끊었어요!"; }
      return "며칠 참다가 다시 피웠어요.";
    },
  };
  DEC.drink = {
    open(s) {
      return {
        title: "술자리", body: "어른이 되니 술자리가 잦아졌어요.",
        facts: [fact(`${P(s).ko} 1인당 연간 알코올 소비: ${(W(s.iso, "SH.ALC.PCAP.LI") || 0).toFixed(1)}L`, "WHO·세계은행")],
        options: [
          { key: "none", label: "마시지 않는다", hint: "" },
          { key: "some", label: "적당히 즐긴다", hint: "" },
          { key: "heavy", label: "자주, 많이 마신다", hint: "" },
        ],
      };
    },
    resolve(s, key) {
      s.habit.drink = { none: 0, some: 1, heavy: 2 }[key];
      if (key === "heavy") add(s, "social", 4);
      return { none: "술은 멀리하기로 했어요.", some: "가끔 한두 잔 하는 정도예요.", heavy: "술자리를 빠지지 않는 사람이 됐어요." }[key];
    },
  };
  DEC.hobby = {
    open(s) {
      const p = P(s);
      const net = s.child.internet;
      const pool = [
        { key: "sport", label: `${p.sport || "축구"}`, hint: "건강↑ 친구↑" },
        { key: "read", label: "책 읽기", hint: "지식↑" },
        { key: "music", label: "음악", hint: "행복↑" },
        { key: "faith", label: `${s.fam.rel === "무교" ? "봉사 활동" : "종교 모임"}`, hint: "관계↑" },
      ];
      if (net) pool.push({ key: "games", label: "게임·인터넷", hint: "재미↑ 공부↓" });
      else pool.push({ key: "craft", label: "손으로 만들기", hint: "기술↑" });
      return { title: "시간이 나면 무엇을 할까", body: "학교와 집안일 사이 틈이 생기면 하는 일이 있어요.", facts: [fact(`${p.ko} 인터넷 사용률: ${Math.round(W(s.iso, "IT.NET.USER.ZS") || 0)}%`, "ITU·세계은행")], options: pool };
    },
    resolve(s, key, dec) {
      s.hobby = key;
      const o = dec.options.find((x) => x.key === key);
      return `${o.label}에 빠졌어요.`;
    },
  };

  // ---------- moving ----------
  DEC.move_city = {
    open(s) {
      if (s.urban) return null;
      const p = P(s);
      const city = R.pick(s, p.cities);
      return {
        title: "도시로 갈까", body: `${city}에 가면 일자리가 더 많다고 해요.`,
        facts: [fact(`${p.ko} 도시 인구 비율: ${Math.round(W(s.iso, "SP.URB.TOTL.IN.ZS") || 50)}%`)],
        ctx: { city },
        options: [
          { key: "go", label: `${city}로 간다`, hint: "새 일자리, 높은 생활비" },
          { key: "stay", label: "고향에 남는다", hint: "" },
        ],
      };
    },
    resolve(s, key, dec) {
      if (key === "stay") return "고향에 남기로 했어요.";
      s.urban = true; s.place = dec.ctx.city;
      add(s, "social", -6); add(s, "happy", -3);
      if (s.job && s.job.isco === 6) { s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) }); s.job = null; }
      if (!s.job && !s.edu.inSchool) s.looking = true;
      s.indep = s.indep || s.age >= 17;
      return `${dec.ctx.city}로 이사했어요.`;
    },
  };
  // migration corridors: where people from here actually tend to go
  function corridors(s) {
    const o = s.iso, r = D.c[o].r;
    const by = {
      IND: ["ARE", "SAU", "USA", "GBR", "CAN"], PAK: ["SAU", "ARE", "GBR"], BGD: ["SAU", "ARE", "MYS", "GBR"], NPL: ["QAT", "MYS", "ARE"],
      PHL: ["SAU", "ARE", "USA", "JPN"], IDN: ["MYS", "SAU", "JPN"], VNM: ["JPN", "KOR", "TWN"], MEX: ["USA"], GTM: ["USA"], HND: ["USA"], SLV: ["USA"],
      NGA: ["GBR", "USA", "CAN"], GHA: ["GBR", "USA"], SEN: ["FRA", "ESP", "ITA"], MLI: ["FRA", "CIV"], CIV: ["FRA"], COD: ["FRA", "BEL", "ZAF"],
      EGY: ["SAU", "ARE", "ITA"], MAR: ["FRA", "ESP", "ITA"], DZA: ["FRA"], TUN: ["FRA", "ITA"], SYR: ["DEU", "TUR"], AFG: ["IRN", "PAK", "DEU"],
      CHN: ["USA", "JPN", "AUS", "CAN"], KOR: ["USA", "AUS", "CAN", "JPN"], JPN: ["USA", "AUS"], UKR: ["POL", "DEU", "CZE"], RUS: ["DEU", "ARE", "TUR"],
      BRA: ["USA", "PRT", "JPN"], COL: ["ESP", "USA"], VEN: ["COL", "PER", "ESP"], ETH: ["SAU", "USA"], KEN: ["SAU", "GBR", "USA"], UGA: ["SAU", "ARE"],
      ZWE: ["ZAF", "GBR"], MOZ: ["ZAF"], USA: ["CAN", "GBR"], GBR: ["AUS", "USA", "ESP"], DEU: ["CHE", "AUT", "USA"], TUR: ["DEU"], IRN: ["DEU", "CAN", "TUR"],
    }[o];
    const reg = { SAS: ["ARE", "SAU", "GBR"], SSF: ["FRA", "GBR", "ZAF"], MEA: ["DEU", "FRA", "SAU"], LCN: ["USA", "ESP"], EAS: ["USA", "JPN", "AUS"], ECS: ["DEU", "GBR"], NAC: ["CAN", "GBR"] }[r];
    return (by || reg).filter((x) => x !== o && D.c[x]);
  }
  DEC.emigrate = {
    open(s, mode) {
      const dests = corridors(s).slice(0, 3);
      if (!dests.length) return null;
      const gulf = ["SAU", "ARE", "QAT", "KWT", "OMN", "BHR"];
      const opts = dests.map((d) => {
        const hic = D.c[d].i === "HIC";
        const legal = gulf.includes(d) ? 0.45 : clamp(0.08 + (s.edu.level >= 5 ? 0.22 : 0) + (s.edu.level >= 6 ? 0.1 : 0) + (s.st.smarts - 50) / 200 + (s.savings > monthly(s) * 12 ? 0.1 : 0) + (isHIC(s) ? 0.3 : 0), 0.03, 0.85);
        return { key: "go_" + d, label: `${C.countries[d][0]}(으)로 간다`, hint: gulf.includes(d) ? "취업 알선 수수료, 건설·가사 일이 많아요" : `비자를 받을 가능성 ${legal > 0.5 ? "높음" : legal > 0.25 ? "보통" : "낮음"}`, legal };
      });
      const poorOrigin = ["LIC", "LMC"].includes(D.c[s.iso].i) && ["SSF", "MEA", "SAS"].includes(D.c[s.iso].r);
      if (poorOrigin) {
        opts.push({ key: "boat", label: "브로커를 통해 몰래 국경·바다를 건넌다", hint: "도착하지 못하는 사람도 있어요" });
      }
      opts.push({ key: "stay", label: "여기 남는다", hint: "" });
      const rem = W(s.iso, "BX.TRF.PWKR.DT.GD.ZS") || 0;
      return {
        title: "해외로 갈까", body: mode === "work" ? "해외 일자리를 알아봤어요." : "외국에 나가 일하는 사람들 이야기가 자주 들려요.",
        facts: [fact(`해외 송금이 ${P(s).ko} 경제에서 차지하는 비중: GDP의 ${rem.toFixed(1)}%`), fact(`국제 순이주율: 인구 1000명당 ${(D.c[s.iso].mig || 0).toFixed(1)}명`, "UN WPP 2024")],
        ctx: { legal: Object.fromEntries(opts.filter((o) => o.legal != null).map((o) => [o.key, o.legal])) },
        options: opts.map((o) => { const x = Object.assign({}, o); delete x.legal; return x; }),
      };
    },
    resolve(s, key, dec) {
      if (key === "stay") return "떠나지 않기로 했어요.";
      if (key === "boat") {
        const fee = E.natMeanPC(s.iso) * 10;
        s.savings -= fee; s.debt = (s.debt || 0) + Math.max(0, -s.savings);
        const x = R.f(s);
        if (x < 0.02) { E.die(s, "drowning", "이주 경로에서"); return "바다를 건너다 배가 뒤집혔어요."; }
        if (x < 0.5) { add(s, "happy", -15); add(s, "health", -8); return "국경에서 붙잡혀 돌려보내졌어요. 브로커에게 준 돈만 날렸어요."; }
        const d = R.pick(s, ["ITA", "ESP", "FRA", "DEU"].filter((k) => D.c[k]));
        EV.moveTo(s, d, "irregular");
        return `목숨을 걸고 ${C.countries[d][0]}에 도착했어요. 서류가 없어 일자리를 구하기가 쉽지 않아요.`;
      }
      const d = key.slice(3);
      const legal = dec.ctx.legal[key] || 0.3;
      if (!R.chance(s, legal)) { s.savings -= E.natMeanPC(s.iso) * 2; add(s, "happy", -6); return `${C.countries[d][0]} 비자가 거절됐어요.`; }
      const gulf = ["SAU", "ARE", "QAT", "KWT", "OMN", "BHR"].includes(d);
      if (gulf) s.debt = (s.debt || 0) + E.meanEarnMonth(d) * 3 * (E.lcuPerPPP(s.iso) / E.lcuPerPPP(d));
      EV.moveTo(s, d, gulf ? "gulf" : "legal");
      return `${C.countries[d][0]}(으)로 떠났어요.`;
    },
  };
  EV.moveTo = function (s, d, how) {
    // money converted through purchasing power, so a life's savings keep their real value
    const rate = E.lcuPerPPP(d) / E.lcuPerPPP(s.iso);
    s.savings *= rate; s.debt = (s.debt || 0) * rate;
    if (s.job) { s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) }); s.job = null; }
    s.business = null;
    s.prevIso = s.iso; s.iso = d; s.urban = true; s.place = R.pick(s, E.prof(d).cities);
    s.migrant = how; s.movedAt = s.age; s.indep = true;
    s.looking = how !== "study";
    s.lookPrefer = how === "gulf" ? { 7: 3, 9: 3, 8: 2, 5: 1.5, 2: 0.2 } : how === "irregular" ? { 9: 4, 5: 2, 7: 2, 2: 0.05, 3: 0.2, 4: 0.2 } : null;
    if (s.partner && s.partner.status === "married") s.partner.pay = 0;
    add(s, "social", -12); add(s, "happy", -5);
    log(s, `${E.prof(d).ko} ${s.place}에서 새 삶을 시작했어요.`, "move");
  };

  // ---------- money ----------
  DEC.invest = {
    open(s) {
      const sp = s.spend || E.needsMonth(s);
      if (s.savings < sp * 6) return null;
      const house = E.natMeanPC(s.iso) * 12 * ({ KOR: 16, CHN: 14, HKG: 25 }[s.iso] || (isHIC(s) ? 8 : 10)) * (s.urban ? 1.4 : 0.7);
      const mkt = W(s.iso, "CM.MKT.LCAP.GD.ZS");
      const opts = [
        { key: "bank", label: "은행에 둔다", hint: `예금 금리 ${(W(s.iso, "FR.INR.DPST") || 3).toFixed(1)}%, 물가 상승률 ${(W(s.iso, "FP.CPI.TOTL.ZG") || 3).toFixed(1)}%` },
        { key: "stock", label: "주식·펀드에 넣는다", hint: mkt ? "오르내림이 커요" : "이 나라엔 주식시장이 작아요" },
        { key: "house", label: "집을 산다", hint: s.savings >= house * 0.3 ? `집값 약 ${money(s, house)}, 대출 필요` : `집값 약 ${money(s, house)}, 아직 모자라요`, disabled: s.savings < house * 0.3 || s.house },
        { key: "family", label: "가족을 돕는다", hint: "부모·형제에게" },
        { key: "spend", label: "쓰면서 즐긴다", hint: "여행·물건" },
      ];
      return {
        title: "모아둔 돈", body: `모은 돈이 ${money(s, s.savings)}예요. 어떻게 할까요?`,
        facts: [fact(`금융기관·모바일머니 계좌 보유율(15세+): ${Math.round(W(s.iso, "FX.OWN.TOTL.ZS") || 50)}%`, "세계은행 Findex")],
        ctx: { house }, options: opts,
      };
    },
    resolve(s, key, dec) {
      s.investAsked = s.age;
      s.investAt = s.savings;
      if (key === "bank") return "은행에 맡겨두기로 했어요.";
      if (key === "stock") { const amt = s.savings * 0.6; s.savings -= amt; s.invest = s.invest || {}; s.invest.stock = { v: (s.invest.stock ? s.invest.stock.v : 0) + amt, r: 0 }; return `${money(s, amt)}를 주식·펀드에 넣었어요.`; }
      if (key === "house") {
        const h = dec.ctx.house; const down = h * 0.3;
        s.savings -= down; s.debt = (s.debt || 0) + (h - down); s.house = { value: h, bought: s.age };
        add(s, "happy", 8);
        return `집을 샀어요. ${money(s, h - down)}는 대출이에요.`;
      }
      if (key === "family") { const g = s.savings * 0.3; s.savings -= g; add(s, "happy", 4); add(s, "social", 4); return `${money(s, g)}를 가족에게 보냈어요.`; }
      const g = s.savings * 0.25; s.savings -= g; add(s, "happy", 10);
      return `${money(s, g)}를 여행과 물건에 썼어요.`;
    },
  };
  function moneyYearly(s) {
    if (s.invest && s.invest.stock) {
      const st = s.invest.stock;
      const r = s.recession === s.year ? R.normal(s, -0.25, 0.1) : R.normal(s, 0.055, 0.17);
      st.v *= 1 + r;
      if (r < -0.2) log(s, `주식 시장이 폭락했어요. 투자금이 ${Math.round(-r * 100)}% 줄었어요.`, "money");
      else if (r > 0.25) log(s, `주식이 크게 올랐어요 (+${Math.round(r * 100)}%).`, "money");
    }
    if (s.house) s.house.value *= 1 + R.normal(s, 0.015, 0.06);
    // loan repayment: a slice of debt each year out of savings
    if (s.debt > 0) {
      const pay = Math.min(s.debt, s.debt * 0.08 + Math.max(0, s.savings) * 0.2);
      s.debt -= pay; s.savings -= pay;
      if (s.debt < 1) s.debt = 0;
    }
    if (s.chronicCost) s.savings -= s.chronicCost * 12;
    // world position for the end screen
    s.peakWorld = Math.max(s.peakWorld || 0, E.worldPct(E.perCapitaPPP(s)));
  }

  DEC.parents_care = {
    open(s) {
      const p = [s.fam.father, s.fam.mother].filter((x) => x.alive && x.age >= 68);
      if (!p.length || !s.indep) return null;
      const who = p.length === 2 ? "부모님" : p[0] === s.fam.father ? "아버지" : "어머니";
      return {
        title: `${who}가 연로하세요`, body: `${who}가 ${Math.max(...p.map((x) => x.age))}세예요. 혼자 지내기 점점 힘들어하세요.`,
        facts: [fact(`${P(s).ko} 65세 이상 인구 비율: ${(W(s.iso, "SP.POP.65UP.TO.ZS") || 0).toFixed(1)}%`)],
        options: [
          { key: "live", label: "모시고 산다", hint: "생활비↑ 시간↓" },
          { key: "send", label: "생활비를 보내드린다", hint: "수입의 10%" },
          ...(isHIC(s) ? [{ key: "care", label: "요양 시설에 모신다", hint: "비용이 커요" }] : []),
          { key: "sib", label: "형제에게 맡긴다", hint: s.fam.sibs ? "" : "형제가 없어요", disabled: !s.fam.sibs },
        ],
      };
    },
    resolve(s, key) {
      s.careAsked = s.age;
      if (key === "live") { s.parentSupport = E.natMeanPC(s.iso) * 0.5; add(s, "happy", -2); add(s, "social", 2); return "부모님을 모시고 살기 시작했어요."; }
      if (key === "send") { s.parentSupport = E.householdIncome(s) * 0.1; return "매달 생활비를 보내드려요."; }
      if (key === "care") { s.parentSupport = E.natMeanPC(s.iso) * 1.2; return "요양 시설에 모셨어요. 자주 찾아뵈려 해요."; }
      add(s, "social", -3);
      return "형제가 부모님을 모시기로 했어요.";
    },
  };
  DEC.conflict = {
    open(s) {
      return {
        title: "분쟁이 가까워졌어요", body: `${s.place} 근처에서 총성이 들려요. 이웃들이 하나둘 떠나고 있어요.`,
        facts: [fact(`${P(s).ko} 출신 난민: ${Math.round((W(s.iso, "SM.POP.REFG.OR") || 0) / 1000).toLocaleString()}천 명`, "UNHCR·세계은행"), fact(`분쟁 관련 사망(최근 1년): ${Math.round(W(s.iso, "VC.BTL.DETH") || 0).toLocaleString()}명`, "UCDP·세계은행")],
        options: [
          { key: "inside", label: "나라 안 안전한 곳으로 피난한다", hint: "일과 집을 잃어요" },
          { key: "abroad", label: "국경을 넘어 피난한다", hint: "난민이 돼요" },
          { key: "stay", label: "집을 지킨다", hint: "위험해요" },
        ],
      };
    },
    resolve(s, key) {
      if (key === "stay") { s.conflictZone = s.year + 2; add(s, "happy", -10); return "떠나지 않고 버티기로 했어요."; }
      if (s.job) { s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) }); s.job = null; }
      s.business = null; s.house = null; s.savings *= 0.5; s.looking = true; add(s, "happy", -14); add(s, "social", -8);
      if (key === "inside") { s.place = R.pick(s, P(s).cities); s.urban = true; return `${s.place}로 피난했어요. 모든 걸 두고 왔어요.`; }
      s.refugee = s.year; s.migrant = "refugee";
      return "국경을 넘어 난민 캠프에 도착했어요. 언제 돌아갈 수 있을지 몰라요.";
    },
  };
  DEC.retire = {
    open(s) {
      if (!s.job || s.retired) return null;
      const formal = !s.job.informal && !s.job.self;
      const repl = formal ? ({ HIC: 0.5, UMC: 0.55, LMC: 0.4, LIC: 0.3 }[D.c[s.iso].i] || 0.4) : 0;
      return {
        title: "은퇴할 나이", body: formal ? `${P(s).pension}살, 연금을 받을 수 있어요.` : "연금이 없어요. 몸이 허락하는 한 일해야 할 수도 있어요.",
        facts: [fact(`${P(s).ko}의 공식 은퇴 연령: 약 ${P(s).pension}세`, "각국 연금제도")],
        ctx: { repl },
        options: [
          { key: "retire", label: "은퇴한다", hint: formal ? `연금 약 월 ${money(s, s.job.pay * repl)}` : "모아둔 돈과 가족에게 의지" },
          { key: "work", label: "계속 일한다", hint: "" },
        ],
      };
    },
    resolve(s, key, dec) {
      if (key === "work") { s.retireAsked = s.age; return "조금 더 일하기로 했어요."; }
      s.pension = s.job.pay * dec.ctx.repl;
      s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) });
      s.job = null; s.retired = true; s.looking = false; s.focus = s.focus === "work" ? "balance" : s.focus;
      add(s, "happy", 8);
      return "은퇴했어요. 이제 내 시간이에요.";
    },
  };
  DEC.midlife = {
    open(s) {
      return {
        title: "인생의 한가운데", body: `${Math.floor(s.age)}살. 남은 시간을 어떻게 쓸지 생각하게 돼요.`, facts: [],
        options: [
          { key: "learn", label: "새로운 공부를 시작한다", hint: "" },
          { key: "work", label: "일에서 더 높이 올라간다", hint: "" },
          { key: "family", label: "가족과 더 많은 시간을 보낸다", hint: "" },
          { key: "give", label: "봉사하며 산다", hint: "" },
          { key: "play", label: "하고 싶던 걸 한다", hint: "여행·취미" },
        ],
      };
    },
    resolve(s, key) {
      const fx = { learn: ["smarts", 8, "study"], work: ["happy", -2, "work"], family: ["social", 8, "people"], give: ["happy", 8, "people"], play: ["happy", 10, "rest"] }[key];
      add(s, fx[0], fx[1]); s.focus = fx[2];
      return { learn: "새로운 공부를 시작했어요.", work: "일에 더 몰두하기로 했어요.", family: "가족과 보내는 시간을 늘렸어요.", give: "봉사 활동을 시작했어요.", play: "오래 미뤄둔 일을 하기 시작했어요." }[key];
    },
  };

  // ---------- written by the player, shaped by Claude ----------
  // Claude's answer: {chance, success:{text,effects,actions}, failure:{...}, thread, option}
  // Everything is bounded here so a sentence can't break the world's numbers.
  const STAT_KEYS = ["health", "happy", "smarts", "social"];
  function applyEffects(s, fx, ok) {
    fx = fx || {};
    for (const k of STAT_KEYS) if (fx[k] != null) add(s, k, clamp(Math.round(+fx[k] || 0), -15, 15));
    if (fx.money != null) s.savings += clamp(+fx.money || 0, -24, ok ? 12 : 6) * monthly(s);
  }
  const str = (x, n) => String(x == null ? "" : x).replace(/\s+/g, " ").trim().slice(0, n);
  function applyActions(s, actions) {
    if (!Array.isArray(actions)) return;
    for (const a of actions.slice(0, 3)) {
      if (!a || typeof a !== "object") continue;
      const t = a.type;
      if (t === "set_job") {
        const isco = clamp(Math.round(+a.isco || 5), 1, 9);
        const job = E.makeOffer(s, { isco, title: str(a.title, 30) || undefined, formal: a.informal === false && !a.self });
        job.informal = !!a.informal; job.self = !!a.self;
        // pay as a multiple of the national mean wage, capped by the occupation's real pay level
        const ratio = D.c[s.iso].earn[isco] || 1;
        const cap = ratio * (s.edu.level >= 5 ? 3 : 2.2);
        const mult = clamp(+a.pay || ratio, 0.1, Math.max(0.3, cap));
        job.indiv = 1;
        const base = E.payFor(s, job);
        job.indiv = (E.meanEarnMonth(s.iso) * mult) / Math.max(1, base);
        job.pay = E.payFor(s, job);
        EV.takeJob(s, job);
      } else if (t === "quit_job") {
        if (s.job) { s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(s.age) }); s.job = null; }
        if (s.business && a.business) { const last = s.jobsHeld.find((j) => j.biz && j.to == null); if (last) last.to = Math.floor(s.age); s.business = null; }
      } else if (t === "study") {
        const lvl = ["course", "college", "uni", "master", "phd"].includes(a.level) ? a.level : "course";
        const yrs = clamp(+a.years || (lvl === "course" ? 0.5 : 2), 0.25, 6);
        const major = C.majors[a.major] ? a.major : s.edu.major || "hum";
        if (lvl === "course") { s.course = { end: s.age + yrs, name: str(a.name || a.major, 20) }; continue; }
        if (lvl === "master" && s.edu.level < 5) continue;
        if (lvl === "phd" && s.edu.level < 6) continue;
        if ((lvl === "uni" || lvl === "college") && s.edu.level < 3) continue;
        s.edu.inSchool = true; s.edu.stage = lvl; s.edu.end = s.age + yrs; s.edu.major = lvl === "college" ? s.edu.major : major;
        if (s.job) s.edu.partTime = true;
        s.looking = false;
      } else if (t === "business") {
        const cap = clamp(+a.capital || 6, 0, 60) * E.needsMonth(s);
        const r = EV.startBusiness(s, cap);
        if (s.business) {
          s.business.kind = str(a.kind, 20) || s.business.kind;
          const last = s.jobsHeld[s.jobsHeld.length - 1]; if (last && last.biz) last.title = s.business.kind + " 운영";
          if (a.monthly != null) s.business.monthly = E.meanEarnMonth(s.iso) * clamp(+a.monthly, 0.05, 5);
        }
        void r;
      } else if (t === "move_city") {
        s.urban = true; s.place = str(a.city, 20) || R.pick(s, P(s).cities); s.indep = s.indep || s.age >= 17;
      } else if (t === "emigrate") {
        const iso = String(a.iso || "").toUpperCase();
        if (D.c[iso] && iso !== s.iso) EV.moveTo(s, iso, a.irregular ? "irregular" : "legal");
      } else if (t === "relationship") {
        const act = a.action;
        if (act === "date" && single(s)) {
          const psex = s.sex === "m" ? "f" : "m";
          s.partner = { name: str(a.name, 16) || E.nameFor(s, s.iso, psex), age: Math.floor(s.age) + R.int(s, -3, 3), sex: psex, status: "dating", since: s.age, alive: true };
        } else if (act === "marry") {
          if (single(s)) { const psex = s.sex === "m" ? "f" : "m"; s.partner = { name: str(a.name, 16) || E.nameFor(s, s.iso, psex), age: Math.floor(s.age) + R.int(s, -3, 3), sex: psex, status: "dating", since: s.age, alive: true }; }
          if (s.partner.status !== "married") EV.marry(s, weddingCost(s));
        } else if ((act === "breakup" || act === "divorce") && s.partner && s.partner.alive) {
          if (s.partner.status === "married") { s.divorced = (s.divorced || 0) + 1; s.savings *= 0.7; }
          s.partner = null;
        }
      } else if (t === "kids") {
        if (["try", "wait", "stop"].includes(a.plan)) { s.kidPlan = a.plan; s.kidAsked = s.age; }
      } else if (t === "habit") {
        if (a.smoke === true) s.habit.smoke = true;
        if (a.smoke === false && s.habit.smoke) { s.habit.smoke = false; s.habit.quitAt = s.age; }
        if (a.drink != null) s.habit.drink = clamp(Math.round(+a.drink), 0, 2);
      }
    }
  }
  // roll the odds Claude gave, apply that branch, keep the story going if Claude opened one
  EV.outcome = function (s, res, label, threadId) {
    res = res || {};
    let chance = clamp(+res.chance || 0.3, 0.01, 0.95);
    if (res.feasible === false) chance = Math.min(chance, 0.03);
    const ok = R.chance(s, chance);
    const br = (ok ? res.success : res.failure) || {};
    const text = str(br.text, 400) || (ok ? "생각대로 됐어요." : "생각대로 되지 않았어요.");
    log(s, text, "choice");
    applyEffects(s, br.effects, ok);
    applyActions(s, br.actions);
    // a story that continues: Claude writes its next scene when it comes due
    const th = threadId ? s.threads.find((x) => x.id === threadId) : null;
    if (th) th.steps.push({ age: Math.floor(s.age), what: str(label, 120), result: text });
    const next = res.thread;
    if (th && (res.done || !next)) th.done = true;
    if (next && typeof next === "object" && !next.done) {
      const months = clamp(Math.round(+next.inMonths || 6), 1, 36);
      if (th) { th.due = s.age + months / 12; th.note = str(next.note, 200) || th.note; th.done = false; }
      else if (s.threads.filter((x) => !x.done).length < 4) {
        s.threads.push({ id: "t" + (s.threads.length + 1), title: str(next.title, 30) || str(label, 30), note: str(next.note, 200), started: Math.floor(s.age), due: s.age + months / 12, steps: [{ age: Math.floor(s.age), what: str(label, 120), result: text }] });
      }
    }
    return { ok, text, chance };
  };
  EV.resolveFree = function (s, dec, text, res) {
    log(s, `✍ ${text}`, "free");
    const opt = res && res.option && dec.options.find((o) => o.key === res.option && !o.disabled);
    const r = EV.outcome(s, res, text);
    // the closest regular option, when Claude matched the text to one and it worked out
    if (opt && r.ok) {
      const r2 = DEC[dec.id].resolve(s, opt.key, dec);
      if (r2) { log(s, r2, "choice"); r.text += " " + r2; }
    }
    return r;
  };
  // a story's next scene is due: the page asks Claude to write it (on the player's click)
  DEC.thread = {
    open(s, id) {
      const th = s.threads.find((x) => x.id === id);
      if (!th || th.done) return null;
      return {
        title: th.title, body: th.note || "이어지는 이야기가 있어요.", facts: [], claude: "thread", threadId: id,
        options: [
          { key: "drop", label: "이 일은 여기서 접는다", hint: "" },
          { key: "keep", label: "그대로 계속한다", hint: "" },
        ],
      };
    },
    resolve(s, key, dec) {
      const th = s.threads.find((x) => x.id === dec.threadId);
      if (!th) return null;
      if (key === "drop") { th.done = true; return `'${th.title}'은(는) 여기까지 하기로 했어요.`; }
      th.due = s.age + 1;
      return `'${th.title}'을(를) 계속해요.`;
    },
  };
  function threadsMonthly(s) {
    if (s.course && s.age >= s.course.end) {
      add(s, "smarts", 5);
      log(s, `${s.course.name ? s.course.name + " " : ""}과정을 마쳤어요.`, "edu");
      if (s.job) s.job.perf = (s.job.perf || 0) + 0.03;
      s.course = null;
    }
    for (const th of s.threads) if (!th.done && th.due != null && s.age >= th.due) { th.due = null; E.queue(s, "thread", 0, th.id); }
  }

  // ---------- scheduling ----------
  EV.yearly = function (s) {
    const a = s.age, p = P(s), d = D.c[s.iso];
    const inYear = () => R.int(s, 1, 11);
    // school milestones
    if (s.edu.inSchool && s.edu.stage === "low" && a < 15.6) E.queue(s, "school_next", Math.max(0, Math.round((15.5 - a) * 12)));
    if (!s.hobbyAsked && a < 17) { s.hobbyAsked = true; E.queue(s, "hobby", 2); }
    if (!s.smokeAsked && a >= 15 && a < 19 && R.chance(s, 0.5)) { s.smokeAsked = true; E.queue(s, "smoke", inYear()); }
    if (!s.drinkAsked && a >= 18 && a < 22 && (W(s.iso, "SH.ALC.PCAP.LI") || 0) > 2 && R.chance(s, 0.6)) { s.drinkAsked = true; E.queue(s, "drink", inYear()); }
    if (s.habit.smoke && (!s.quitAsked || a - s.quitAsked >= 6) && a >= 25) { s.quitAsked = a; E.queue(s, "quit_smoke", inYear()); }
    // military
    const army = p.army;
    if (army && (s.sex === "m" || army[3]) && !s.army && a >= army[1] && a < army[2] && !s.armyDodged && !s.migrant) {
      const late = a >= army[2] - 1;
      const deferred = s.armyDefer && s.year - s.armyDefer < 2;
      const call = late || (!deferred && (!s.edu.inSchool ? true : s.edu.stage === "uni" ? R.chance(s, 0.5) : false));
      if (call) E.queue(s, "army_call", inYear());
    }
    // girls married off young (annual hazard from the share married by 18)
    if (s.sex === "f" && a < 18 && !s.partner && (!s.teenDelay || s.year - s.teenDelay >= 2)) {
      const m15 = Wp(s.iso, "SP.M15.2024.FE.ZS", 0.01), m18 = Wp(s.iso, "SP.M18.2024.FE.ZS", 0.03);
      const h = 1 - Math.pow(Math.max(0.01, 1 - (m18 - m15) / Math.max(0.05, 1 - m15)), 1 / 3);
      if (R.chance(s, shift(h, -1.3 * (s.fam.u - 0.5) + (s.urban ? -0.4 : 0.4) + (s.edu.inSchool ? -0.6 : 0.5)))) E.queue(s, "teen_marriage", inYear());
    }
    // love and marriage
    const smam = p.smam[s.sex === "m" ? 0 : 1];
    const arr = p.arranged || 0;
    const sing50 = (p.single50 || [0.06, 0.04])[s.sex === "m" ? 0 : 1];
    if ((!s.partner || !s.partner.alive || s.partner.status === "none") && a >= 16 && a < 60) {
      if (arr > 0.2 && a >= smam - 3 && a < smam + 12 && R.chance(s, arr * 0.45 * (s.arrangedNo ? 0.7 : 1))) E.queue(s, "arranged", inYear());
      else {
        const peak = a < 18 ? 0.12 : a < 23 ? 0.3 : a < 33 ? 0.36 : a < 45 ? 0.2 : 0.08;
        if (R.chance(s, peak * (1 - arr * 0.6) * (1 - sing50) * clamp(0.5 + s.st.social / 100, 0.4, 1.4))) E.queue(s, "romance", inYear());
      }
    }
    if (s.partner && s.partner.alive && s.partner.status === "dating" && a - s.partner.since >= 0.8) {
      const pr = a < smam - 4 ? 0.15 : a < smam + 4 ? 0.5 : 0.35;
      if (R.chance(s, pr * (1 - sing50 * 0.8))) E.queue(s, "proposal", inYear());
      else if (R.chance(s, 0.18)) { log(s, `${s.partner.name}와(과) 헤어졌어요.`, "family"); s.partner = null; add(s, "happy", -8); }
    }
    if (s.partner && s.partner.alive && s.partner.status === "married") {
      const fa = s.sex === "f" ? a : s.partner.age;
      if (fa < 45 && !s.pregnant && (!s.kidAsked || a - s.kidAsked >= 2) && s.kidPlan !== "stop") E.queue(s, "kids", inYear());
      const div = { NAC: 0.012, ECS: 0.01, LCN: 0.006, EAS: 0.007, MEA: 0.005, SSF: 0.005, SAS: 0.001 }[d.r] || 0.005;
      if (R.chance(s, div * (s.st.happy < 40 ? 3 : 1) * 2)) E.queue(s, "marriage_trouble", inYear());
    }
    // work
    jobYearly(s); businessYearly(s); moneyYearly(s);
    if (s.careBreak && a >= s.careBreak && !s.job) { s.careBreak = null; s.looking = true; }
    // asked again only after savings have grown a lot since the last time
    if (s.indep && s.savings > (s.spend || E.needsMonth(s)) * 6 && (!s.investAsked || (a - s.investAsked >= 6 && s.savings > (s.investAt || 0) * 1.6)) && R.chance(s, 0.5)) E.queue(s, "invest", inYear());
    if (s.job && !s.retired && a >= p.pension && (!s.retireAsked || a - s.retireAsked >= 3)) E.queue(s, "retire", inYear());
    if (s.job && !s.retired && a >= 72 && (s.job.informal || s.job.self) && R.chance(s, 0.3 + (60 - s.st.health) / 100)) {
      log(s, "몸이 예전 같지 않아 일을 놓았어요.", "work");
      s.jobsHeld.push({ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(a) }); s.job = null; s.retired = true;
    }
    if (s.retired && !s.pension) {
      const adultKids = s.kids.filter((k) => k.alive && s.year - k.born >= 22).length;
      s.pension = adultKids ? E.natMeanPC(s.iso) * 0.25 * Math.min(3, adultKids) : 0;
    }
    if ([s.fam.father, s.fam.mother].some((x) => x.alive && x.age >= 68) && s.indep && (!s.careAsked || a - s.careAsked >= 10) && R.chance(s, 0.35)) E.queue(s, "parents_care", inYear());
    if (a >= 40 && a < 52 && !s.midAsked && R.chance(s, 0.25)) { s.midAsked = true; E.queue(s, "midlife", inYear()); }
    // moving
    if (!s.urban && a >= 16 && a < 40 && (!s.cityAsked || a - s.cityAsked >= 5) && R.chance(s, 0.25)) { s.cityAsked = a; E.queue(s, "move_city", inYear()); }
    const rem = (W(s.iso, "BX.TRF.PWKR.DT.GD.ZS") || 0) / 100;
    // a real chance to leave comes rarely; more often where emigration is common (remittances)
    const emi = clamp(rem * 0.15 + Math.max(0, -(d.mig || 0)) / 200 + (s.edu.level >= 5 ? 0.01 : 0), 0.003, 0.03) * (isHIC(s) ? 0.5 : 1) * (s.sex === "f" && !["PHL", "IDN", "LKA", "ETH", "NPL"].includes(s.iso) ? 0.6 : 1);
    if (!s.migrant && a >= 18 && a < 42 && (!s.emiAsked || a - s.emiAsked >= 5) && R.chance(s, emi)) { s.emiAsked = a; E.queue(s, "emigrate", inYear()); }
    // illness: diagnosed several times more often than it kills
    const q = E.annualRisk(s);
    if (R.chance(s, clamp(q * 2, 0.003, 0.25))) {
      let c = E.sampleCause(s);
      if (["road", "drowning", "falls", "fire", "poison", "disaster", "injury_other", "suicide", "homicide", "war", "maternal"].includes(c)) {
        if (["road", "falls", "injury_other", "fire"].includes(c) && R.chance(s, 0.6)) {
          const t = { road: "교통사고로 크게 다쳤어요.", falls: "높은 곳에서 떨어져 다쳤어요.", injury_other: "일하다 사고로 다쳤어요.", fire: "불에 데어 화상을 입었어요." }[c];
          log(s, t, "health"); add(s, "health", -12); s.savings -= E.natMeanPC(s.iso) * 2;
        }
      } else if (!s.cond[c]) E.queue(s, "health_scare", inYear(), c);
    }
    if (s.st.happy < 28 && (!s.mentalAsked || a - s.mentalAsked >= 3)) { s.mentalAsked = a; E.queue(s, "mental_low", inYear()); }
    // conflict reaching home
    const pop = (d.pop || 1000) * 1000;
    const pc = clamp((W(s.iso, "SM.POP.REFG.OR") || 0) / pop / 8 + (W(s.iso, "VC.BTL.DETH") || 0) / pop * 50, 0, 0.2);
    if (!s.refugee && R.chance(s, pc)) E.queue(s, "conflict", inYear());
    if (s.conflictZone && s.year > s.conflictZone) s.conflictZone = null;
    // the economy: a recession somewhere every ~9 years
    if (R.chance(s, 0.11)) { s.recession = s.year; if (s.indep) log(s, "경기가 나빠졌어요. 주변에 일자리를 잃는 사람이 늘어요.", "world"); }
    if (s.refugee && s.year - s.refugee >= 6 && R.chance(s, 0.3)) { s.refugee = null; s.migrant = null; log(s, "분쟁이 잦아들어 고향으로 돌아왔어요.", "move"); }
  };

  EV.monthly = function (s) {
    schoolMonthly(s);
    armyMonthly(s);
    jobMonthly(s);
    kidsMonthly(s);
    threadsMonthly(s);
    if (s.business) s.savings += 0; // business income is in householdIncome
    if (R.chance(s, 0.32)) G.LIFE_FLAVOR && G.LIFE_FLAVOR.pick(s);
  };

  E.EVENTS = EV;
  E.DEC = DEC;
})(typeof window !== "undefined" ? window : globalThis);
