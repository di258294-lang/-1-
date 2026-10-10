// Small everyday moments. Which ones can happen depends on the country's real conditions
// (electricity, water, internet, religion, climate, work); they nudge the stats a little.
(function (G) {
  const E = G.LIFE_ENGINE;
  const { R, D } = E;
  const W = E.W;
  const add = E.add;

  const FEST = {
    "이슬람": ["라마단 금식을 마치고 이드 명절을 보냈어요.", "희생제(이드 알아드하)에 친척들이 모였어요."],
    "이슬람(수니)": ["라마단 금식을 마치고 이드 명절을 보냈어요."],
    "이슬람(시아)": ["아슈라 행사에 참여했어요.", "노루즈(새해)를 맞아 대청소를 했어요."],
    "힌두교": ["디왈리 축제에 등불을 밝혔어요.", "홀리 축제에서 색 가루를 뒤집어썼어요."],
    "불교": ["부처님 오신 날 절에 다녀왔어요."],
    "기독교": ["크리스마스에 가족과 교회에 갔어요.", "부활절 예배를 드렸어요."],
    "가톨릭": ["성탄 미사에 갔어요.", "마을 수호성인 축제가 열렸어요."],
    "개신교": ["주일마다 교회에 나가요.", "부흥회가 열렸어요."],
    "개신교(복음주의)": ["주일 예배에서 찬양을 불렀어요."],
    "에티오피아 정교회": ["팀캇(주현절) 축제에 참여했어요.", "메스켈 축제에서 모닥불을 피웠어요."],
    "러시아 정교회": ["정교회 성탄절(1월 7일)을 보냈어요."],
    "콥트 기독교": ["콥트 성탄절 예배에 갔어요."],
    "유대교": ["유월절 식사를 함께했어요."],
  };
  const NATIONAL = {
    KOR: ["설날에 세배를 하고 떡국을 먹었어요.", "추석에 고향에 다녀왔어요."],
    CHN: ["춘절에 온 가족이 모여 만두를 빚었어요.", "중추절에 월병을 먹었어요."],
    VNM: ["뗏(설) 명절에 반쯩을 먹었어요."],
    JPN: ["오봉에 고향에 내려갔어요.", "새해 첫 참배(하쓰모데)를 갔어요."],
    THA: ["송끄란 축제에서 물을 뿌리며 놀았어요."],
    IND: ["크리켓 국가대표 경기를 온 동네가 함께 봤어요."],
    BRA: ["카니발 기간에 거리 행진을 구경했어요."],
    MEX: ["죽은 자의 날에 제단을 꾸몄어요."],
    USA: ["추수감사절에 칠면조를 먹었어요."],
    IRN: ["노루즈에 친척 집을 돌았어요."],
  };
  const COLD = ["KOR", "JPN", "CHN", "RUS", "UKR", "KAZ", "MNG", "CAN", "USA", "DEU", "POL", "FIN", "SWE", "NOR", "BLR", "KGZ", "AFG", "TUR", "IRN", "GBR", "FRA", "CZE", "ROU", "HUN", "PRK"];
  const MONSOON = ["IND", "BGD", "PAK", "NPL", "MMR", "THA", "VNM", "PHL", "LKA", "KHM", "LAO"];

  const POOL = [
    // home conditions
    { w: (s) => (s.child.noPower && !s.indep ? 3 : 0) + (W(s.iso, "EG.ELC.ACCS.ZS") < 95 ? 1 : 0), t: (s) => R.pick(s, ["정전이 돼서 촛불 아래서 저녁을 먹었어요.", "전기가 끊겨 휴대폰을 충전하러 이웃집에 갔어요."]) },
    { w: (s) => (s.child.noWater && !s.indep ? 3 : 0), t: () => "새벽에 물을 길으러 한 시간을 걸었어요.", fx: { health: -0.5 } },
    { w: (s) => ((W(s.iso, "IT.NET.USER.ZS") || 0) > 60 ? 2 : 0), t: (s) => R.pick(s, ["밤늦게까지 휴대폰으로 영상을 봤어요.", "단체 대화방이 하루 종일 시끄러웠어요.", "SNS에서 친구의 소식을 봤어요."]), fx: { happy: 0.5 } },
    { w: (s) => ((W(s.iso, "IT.NET.USER.ZS") || 0) < 40 && !s.child.internet ? 1.5 : 0), t: () => "읍내 가게에서 처음으로 인터넷을 써봤어요." },
    // school
    { w: (s) => (s.edu.inSchool ? 4 : 0), t: (s) => R.pick(s, ["시험을 봤어요. 생각보다 잘 봤어요.", "시험을 망쳤어요.", "선생님께 칭찬을 들었어요.", "숙제를 하다 잠들었어요.", "친구와 도서관에서 공부했어요.", "수업 시간에 졸다 혼났어요."]), fx: (s) => ({ smarts: R.f(s) < 0.5 ? 0.6 : 0.2 }) },
    { w: (s) => (s.edu.inSchool && s.edu.stage === "uni" ? 3 : 0), t: (s) => R.pick(s, ["동아리 MT에 다녀왔어요.", "밤새 과제를 했어요.", "장학금 공고를 찾아봤어요.", "교수님 연구실에 찾아갔어요."]) },
    // work
    { w: (s) => (s.job && s.job.isco === 6 ? 4 : 0), t: (s) => R.pick(s, [`올해 ${E.prof(s.iso).farm || "농사"} 수확이 ${R.f(s) < 0.6 ? "괜찮았어요" : "비 때문에 형편없었어요"}.`, "새벽부터 밭에 나갔어요.", "가축 한 마리가 병에 걸렸어요."]) },
    { w: (s) => (s.job && [7, 8, 9].includes(s.job.isco) ? 3 : 0), t: (s) => R.pick(s, ["하루 12시간을 일했어요.", "현장에서 허리를 다쳐 며칠 쉬었어요.", "일당이 밀렸어요.", "동료들과 일 끝나고 밥을 먹었어요."]), fx: { health: -0.3 } },
    { w: (s) => (s.job && [1, 2, 3, 4].includes(s.job.isco) ? 3 : 0), t: (s) => R.pick(s, ["야근이 이어졌어요.", "회의가 하루 종일 이어졌어요.", "중요한 일을 맡았어요.", "동료가 그만뒀어요."]) },
    { w: (s) => (s.job && s.job.isco === 5 ? 3 : 0), t: (s) => R.pick(s, ["손님이 많아 쉴 틈이 없었어요.", "까다로운 손님 때문에 진땀을 뺐어요.", "단골손님이 생겼어요."]) },
    { w: (s) => (s.looking ? 2 : 0), t: () => "일자리 소식을 들으러 사람들을 만났어요." },
    // people
    { w: (s) => (s.fam.sibs ? 2 : 0), t: (s) => R.pick(s, ["동생 숙제를 봐줬어요.", "형제와 크게 싸웠어요.", "형제가 결혼했어요.", "조카가 태어났어요."]), fx: { social: 0.4 } },
    { w: () => 2, t: (s) => R.pick(s, ["오랜 친구와 밤새 이야기했어요.", "새 친구가 생겼어요.", "친구와 사이가 멀어졌어요.", "이웃 잔치에 초대받았어요."]), fx: (s) => ({ social: R.f(s) < 0.7 ? 0.8 : -0.8 }) },
    { w: (s) => (s.kids.some((k) => k.alive && s.year - k.born < 12) ? 4 : 0), t: (s) => { const k = R.pick(s, s.kids.filter((x) => x.alive && s.year - x.born < 12)); return R.pick(s, [`${k.name}가 처음으로 걸었어요.`, `${k.name}가 학교에 들어갔어요.`, `${k.name}가 밤새 열이 났어요.`, `${k.name}가 그린 그림을 받았어요.`]); }, fx: { happy: 0.8 } },
    { w: (s) => (s.kids.some((k) => k.alive && s.year - k.born >= 18) ? 2 : 0), t: (s) => { const k = R.pick(s, s.kids.filter((x) => x.alive && s.year - x.born >= 18)); return R.pick(s, [`${k.name}가 독립했어요.`, `${k.name}에게서 오랜만에 연락이 왔어요.`, `${k.name}가 손주를 데리고 왔어요.`]); }, fx: { happy: 1 } },
    { w: (s) => (s.partner && s.partner.alive && s.partner.status === "married" ? 2 : 0), t: (s) => R.pick(s, [`${s.partner.name}와(과) 오랜만에 외식을 했어요.`, `${s.partner.name}와(과) 돈 문제로 다퉜어요.`, `${s.partner.name}가 생일을 챙겨줬어요.`]) },
    // seasons and festivals
    { w: (s) => (FEST[s.fam.rel] && s.month % 6 === 3 ? 4 : 0), t: (s) => R.pick(s, FEST[s.fam.rel]), fx: { happy: 1, social: 0.5 } },
    { w: (s) => (NATIONAL[s.iso] && (s.month === 1 || s.month === 8) ? 4 : 0), t: (s) => R.pick(s, NATIONAL[s.iso]), fx: { happy: 1 } },
    { w: (s) => (COLD.includes(s.iso) && (s.month === 0 || s.month === 1 || s.month === 11) ? 3 : 0), t: () => "올겨울 첫눈이 내렸어요." },
    { w: (s) => (MONSOON.includes(s.iso) && s.month >= 6 && s.month <= 8 ? 3 : 0), t: (s) => (s.urban ? "몬순 비로 길이 물에 잠겼어요." : "몬순 비가 쏟아져 논에 물이 찼어요.") },
    { w: () => 1, t: (s) => `${E.prof(s.iso).sport ? E.prof(s.iso).sport.split("·")[0] : "축구"} 경기를 보며 소리를 질렀어요.`, fx: { happy: 0.5 } },
    // money
    { w: (s) => ((W(s.iso, "FP.CPI.TOTL.ZG") || 0) > 15 && s.indep ? 3 : 0), t: () => "물가가 또 올랐어요. 같은 돈으로 살 수 있는 게 줄었어요.", fx: { happy: -0.5 } },
    { w: (s) => (s.indep ? 1 : 0), t: (s) => R.pick(s, ["휴대폰을 새로 샀어요.", "집세가 올랐어요.", "냉장고가 고장 났어요.", "예상치 못한 돈이 들어왔어요."]) },
    // health
    { w: (s) => ((W(s.iso, "SH.MLR.INCD.P3") || 0) > 50 ? 2 : 0), t: () => "말라리아로 며칠 앓아누웠어요.", fx: { health: -2 } },
    { w: (s) => (s.age > 50 ? 2 : 0), t: (s) => R.pick(s, ["무릎이 시큰거려요.", "돋보기를 쓰기 시작했어요.", "건강검진을 받았어요.", "아침 산책이 일과가 됐어요."]) },
    { w: (s) => (s.hobby ? 2 : 0), t: (s) => ({ sport: "운동을 하며 땀을 흘렸어요.", read: "좋은 책을 한 권 다 읽었어요.", music: "좋아하는 노래를 하루 종일 들었어요.", faith: "모임에서 사람들을 만났어요.", games: "게임을 하다 새벽이 됐어요.", craft: "손으로 무언가를 만들었어요." }[s.hobby]), fx: (s) => ({ sport: { health: 0.6 }, read: { smarts: 0.6 }, music: { happy: 0.6 }, faith: { social: 0.6 }, games: { happy: 0.5, smarts: -0.2 }, craft: { smarts: 0.3 } }[s.hobby]) },
  ];

  G.LIFE_FLAVOR = {
    pick(s) {
      const it = R.weighted(s, POOL, (x) => x.w(s));
      if (!it || !it.w(s)) return;
      const text = it.t(s);
      if (!text) return;
      E.log(s, text, "flavor");
      const fx = typeof it.fx === "function" ? it.fx(s) : it.fx;
      if (fx) for (const k in fx) add(s, k, fx[k]);
    },
  };
})(typeof window !== "undefined" ? window : globalThis);
