// Talking to Claude through the artifact's `sample` capability. The game runs without it;
// written actions, story continuations, the tendency reading and the memoir light up when
// sample resolves. Every call starts from a player's click.
(function (G) {
  const E = G.LIFE_ENGINE;
  const AI = { sample: null, ready: false };

  AI.init = async function () {
    try {
      if (G.claude && typeof G.claude.use === "function") AI.sample = await G.claude.use("sample");
    } catch (e) {
      AI.sample = null;
    }
    AI.ready = true;
    return AI.sample;
  };
  AI.errorText = function (e) {
    const c = e && e.code;
    if (["not_granted", "sampling_disabled", "not_declared", "capability_disabled", "capability_removed"].includes(c)) { AI.sample = null; return "Claude를 쓸 수 없어요. 기본 선택지로 진행해 주세요."; }
    if (c === "rate_limited") return "Claude 사용량이 잠시 꽉 찼어요. 조금 뒤에 다시 시도해 주세요.";
    if (c === "session_expired") return "claude.ai에 다시 로그인해야 해요.";
    if (c === "refused") return "Claude가 이 내용에는 답하지 않았어요. 다르게 적어 주세요.";
    if (c === "invalid_json") return "답을 읽지 못했어요. 한 번 더 시도해 주세요.";
    if (c === "cancelled") return "";
    return "연결이 잠시 끊겼어요. 다시 시도해 주세요.";
  };

  function sheet(s) {
    const p = E.prof(s.iso);
    const L = [];
    L.push(`- 나라: ${p.ko} (${s.iso})${s.prevIso ? `, 원래 ${E.prof(s.homeIso).ko} 출신 이주민` : ""}, 사는 곳: ${s.place} (${s.urban ? "도시" : "농촌"})`);
    L.push(`- ${s.year}년, ${Math.floor(s.age)}살, ${s.sex === "m" ? "남성" : "여성"}, 종교 ${s.fam.rel}`);
    L.push(`- 학력: ${E.EDU[s.edu.level]}${s.edu.inSchool ? ` (재학 중: ${s.edu.stage})` : ""}${s.edu.major ? `, 전공 ${E.C.majors[s.edu.major].ko}` : ""}`);
    if (s.job) L.push(`- 일: ${s.job.title} (ISCO ${s.job.isco} ${E.C.iscoName[s.job.isco]}, ${s.job.informal ? "비공식" : s.job.self ? "자영업" : "정규"}), 월 ${E.money(s, s.job.pay)}`);
    if (s.business) L.push(`- 사업: ${s.business.kind}, 월 수익 약 ${E.money(s, s.business.monthly)}`);
    if (!s.job && !s.business) L.push(`- 일: ${s.retired ? "은퇴" : s.looking ? "구직 중" : s.army && s.army.active ? "군 복무 중" : s.edu.inSchool ? "학생" : "없음"}`);
    L.push(`- 돈: 저축 ${E.money(s, s.savings)}, 빚 ${E.money(s, s.debt || 0)}. 이 나라 임금근로자 평균 월급 ${E.money(s, E.meanEarnMonth(s.iso))}, 한 달 기본 생활비 ${E.money(s, E.needsMonth(s))}`);
    const pt = s.partner && s.partner.alive ? `${s.partner.status === "married" ? "배우자" : "연인"} ${s.partner.name}(${s.partner.age}살)` : "미혼/혼자";
    L.push(`- 가족: ${pt}, 자녀 ${s.kids.filter((k) => k.alive).length}명, 아버지 ${s.fam.father.alive ? "생존" : "사망"}, 어머니 ${s.fam.mother.alive ? "생존" : "사망"}, 형제 ${s.fam.sibs}명`);
    L.push(`- 능력치(0~100): 건강 ${Math.round(s.st.health)}, 행복 ${Math.round(s.st.happy)}, 학업·지식(또래 대비) ${Math.round(s.st.smarts)}, 인간관계 ${Math.round(s.st.social)}`);
    L.push(`- 형편: 나라 안 하위 ${Math.round((s.indep ? E.natPct(s) : s.fam.u) * 100)}%, 세계 소득 상위 ${Math.max(1, Math.round(100 - E.worldPct(E.perCapitaPPP(s))))}%`);
    const conds = Object.keys(s.cond).map((k) => E.C.causes[k] + (s.cond[k].treated ? "(치료 중)" : "(방치)"));
    if (conds.length) L.push(`- 앓는 병: ${conds.join(", ")}`);
    if (s.habit.smoke) L.push("- 흡연자");
    const th = s.threads.filter((t) => !t.done).map((t) => t.title);
    if (th.length) L.push(`- 진행 중인 일: ${th.join(", ")}`);
    return L.join("\n");
  }
  function countryFacts(s) {
    const W = E.W, d = E.D.c[s.iso];
    const n = (v, k = 0) => (v == null ? "?" : (+v).toFixed(k));
    return [
      `실업률 ${n(W(s.iso, "SL.UEM.TOTL.ZS"), 1)}%, 청년 실업률 ${n(W(s.iso, "SL.UEM.1524.ZS"), 1)}%`,
      `비농업 비공식 고용 ${n(W(s.iso, "SL.ISV.IFRM.ZS"))}%, 자영업 비율 ${n(W(s.iso, "SL.EMP.SELF.ZS"))}%`,
      `대학 진학률 ${n(W(s.iso, s.sex === "m" ? "SE.TER.ENRR.MA" : "SE.TER.ENRR.FE"))}%, 25세 이상 대졸 ${n(W(s.iso, "SE.TER.CUAT.BA.ZS"), 1)}%`,
      `1인당 GDP(구매력) $${Math.round(d.gk)}, 하루 3달러 미만 빈곤 ${n(W(s.iso, "SI.POV.DDAY"), 1)}%`,
      `인터넷 사용 ${n(W(s.iso, "IT.NET.USER.ZS"))}%, 금융계좌 보유 ${n(W(s.iso, "FX.OWN.TOTL.ZS"))}%`,
    ].map((x) => "- " + x).join("\n");
  }
  function recent(s, n) {
    return s.log.filter((e) => e.k !== "flavor").slice(-n).map((e) => `${e.age}살: ${e.t}`).join("\n");
  }

  const OUTCOME_FORMAT = `결과는 JSON 하나로:
{"summary":"행동 요약(12자 안팎)","feasible":true,"chance":0.35,"why":"확률 근거 한 줄, 가능하면 위 통계를 인용",
 "success":{"text":"일어난 일 2~3문장","effects":{"happy":5,"money":2},"actions":[]},
 "failure":{"text":"일어난 일 2~3문장","effects":{"happy":-4},"actions":[]},
 "thread":null}
- chance: 이 사람의 나라·형편·학력·나이에서 실제로 성공할 확률(0~1). 어려운 일은 낮게, 마법은 없음. 불법·위험한 행동은 처벌·부상·손실도 현실적으로.
- text: 한국어 존댓말 '~했어요' 체. 게임 속 인물에게 실제로 일어난 일로, 장소·사람·숫자를 구체적으로.
- effects: health, happy, smarts, social은 -15~15 정수. money는 '한 달 생활비 몇 달치' -24~12 (벌면 양수).
- actions: 이 일로 인물의 처지가 바뀔 때만, 최대 3개. 쓸 수 있는 것:
  {"type":"set_job","title":"직업명","isco":1~9,"pay":이 나라 평균 월급의 몇 배(0.1~6),"informal":false,"self":false}
  {"type":"quit_job"}
  {"type":"study","level":"course|college|uni|master|phd","years":0.25~6,"major":"eng|med|biz|edu|hum|sci|law|art|agr","name":"과정 이름"}
  {"type":"business","kind":"사업 종류","capital":밑천(생활비 몇 달치 0~60),"monthly":월 수익(평균 월급의 몇 배)}
  {"type":"move_city","city":"도시"}  {"type":"emigrate","iso":"ISO3 코드","irregular":false}
  {"type":"relationship","action":"date|marry|breakup|divorce","name":"상대 이름"}
  {"type":"kids","plan":"try|wait|stop"}  {"type":"habit","smoke":true,"drink":0~2}
  (ISCO 1 관리자, 2 전문가, 3 기술·준전문가, 4 사무, 5 서비스·판매, 6 농림어업, 7 기능원, 8 기계조작·운전, 9 단순노무)
- thread: 창업, 공부, 연애, 준비, 프로젝트처럼 시간이 걸리고 뒷이야기가 있는 일이면 {"title":"이야기 이름(15자 안팎)","note":"다음에 확인할 것 한 줄","inMonths":3~24}. 한 번에 끝나는 일이면 null.`;

  async function ask(prompt, signal) {
    const res = await AI.sample.json(prompt, { modelTier: "default", effort: "low", signal, cache: false });
    if (!res || typeof res !== "object") throw { code: "invalid_json" };
    return res;
  }

  // a choice the player wrote inside a decision
  AI.judge = async function (s, dec, text, signal) {
    const opts = dec.options.map((o) => `- ${o.key}: ${o.label}${o.hint ? ` (${o.hint})` : ""}${o.disabled ? " [지금은 불가]" : ""}`).join("\n");
    const facts = (dec.facts || []).map((f) => `- ${f.t} [${f.src}]`).join("\n");
    return ask(`너는 실제 통계에 기반한 인생 시뮬레이션 게임의 이야기꾼이자 판정자야. 플레이어가 결정 상황에서 기본 선택지 대신 하고 싶은 행동을 직접 적었어. 그 행동이 이 사람의 현실에서 어떻게 펼쳐질지 만들어 줘.

[인물]
${sheet(s)}

[최근 일]
${recent(s, 12)}

[이 나라 실제 통계]
${facts}
${countryFacts(s)}

[상황] ${dec.title}
${dec.body}

[게임의 기본 선택지]
${opts}

[플레이어가 적은 행동]
"${text.replace(/"/g, "'").slice(0, 600)}"

${OUTCOME_FORMAT}
- 추가: 적은 행동이 기본 선택지 중 하나와 사실상 같으면 "option"에 그 key를 넣어(불가 선택지 제외). 아니면 "option":null.`, signal);
  };

  // an action written at any moment of the life
  AI.act = async function (s, text, signal) {
    return ask(`너는 실제 통계에 기반한 인생 시뮬레이션 게임의 이야기꾼이자 판정자야. 플레이어가 지금 이 인물에게 하게 하고 싶은 일을 직접 적었어. 그 일이 이 사람의 현실에서 어떻게 펼쳐질지 만들어 줘.

[인물]
${sheet(s)}

[최근 일]
${recent(s, 14)}

[이 나라 실제 통계]
${countryFacts(s)}

[플레이어가 적은 행동]
"${text.replace(/"/g, "'").slice(0, 600)}"

${OUTCOME_FORMAT}`, signal);
  };

  // the next scene of a story the player started
  AI.threadScene = async function (s, th, signal) {
    const steps = th.steps.map((x) => `- ${x.age}살: ${x.what} → ${x.result}`).join("\n");
    const res = await ask(`너는 실제 통계에 기반한 인생 시뮬레이션 게임의 이야기꾼이야. 플레이어가 시작한 일이 몇 달 지나 다음 장면을 맞았어. 지금 이 시점에 일어날 법한 다음 상황을 결정 장면으로 만들어 줘.

[인물]
${sheet(s)}

[이어지는 이야기] ${th.title} (${th.started}살에 시작)
다음에 볼 것: ${th.note || "-"}
지금까지:
${steps}

[이 나라 실제 통계]
${countryFacts(s)}

규칙: 현실적인 다음 전개(잘 풀리거나, 벽에 부딪히거나, 새 기회가 오거나)를 하나 골라. 선택지는 서로 성격이 다르게 2~4개. 한국어 존댓말.
JSON 하나로: {"title":"장면 제목(15자 안팎)","body":"지금 상황 2~3문장","facts":["이 상황과 관련된 실제 통계나 현실 정보 0~2개"],"options":[{"key":"a","label":"선택지","hint":"짧은 설명"}]}`, signal);
    const opts = Array.isArray(res.options) ? res.options.slice(0, 4).map((o, i) => ({ key: "g" + i, label: String(o.label || o.key || "").slice(0, 60), hint: String(o.hint || "").slice(0, 80) })).filter((o) => o.label) : [];
    if (!opts.length) throw { code: "invalid_json" };
    return {
      id: "thread_gen", title: String(res.title || th.title).slice(0, 40), body: String(res.body || "").slice(0, 400),
      facts: (Array.isArray(res.facts) ? res.facts : []).slice(0, 2).map((t) => ({ t: String(t).slice(0, 160), src: "Claude" })),
      options: opts, claude: "gen", threadId: th.id, age: Math.floor(s.age), year: s.year, free: true,
    };
  };
  // the player picked one of Claude's options (or wrote their own) in that scene
  AI.threadResolve = async function (s, dec, choice, signal) {
    const th = s.threads.find((x) => x.id === dec.threadId) || { title: dec.title, steps: [] };
    const steps = th.steps.map((x) => `- ${x.age}살: ${x.what} → ${x.result}`).join("\n");
    return ask(`너는 실제 통계에 기반한 인생 시뮬레이션 게임의 이야기꾼이자 판정자야. 이어지는 이야기의 한 장면에서 플레이어가 선택을 했어. 결과를 만들어 줘.

[인물]
${sheet(s)}

[이어지는 이야기] ${th.title}
지금까지:
${steps || "-"}

[이 장면] ${dec.title}
${dec.body}
선택지: ${dec.options.map((o) => o.label).join(" / ")}

[플레이어의 선택] "${choice.replace(/"/g, "'").slice(0, 600)}"

[이 나라 실제 통계]
${countryFacts(s)}

${OUTCOME_FORMAT}
- 추가: 이 이야기가 여기서 끝나면 "thread":null 과 "done":true. 이어지면 thread에 다음 장면까지 몇 달인지.`, signal);
  };

  // ---------- reading a life ----------
  function decisionsText(hist, max = 60) {
    const h = hist.length > max ? hist.slice(0, 10).concat(hist.slice(-(max - 10))) : hist;
    return h.map((x) => `- ${x.age}살 [${x.ctx || ""}] ${x.title}${x.body ? ` — ${x.body}` : ""}\n  고를 수 있던 것: ${(x.opts || []).join(" / ") || "(자유 행동)"}\n  고른 것: ${x.label}${x.result ? `\n  결과: ${String(x.result).slice(0, 140)}` : ""}`).join("\n");
  }
  function timeShares(s) {
    const tot = (o) => Object.values(o || {}).reduce((a, b) => a + b, 0) || 1;
    const f = Object.entries(s.focusMonths || {}).map(([k, v]) => `${E.FOCUS[k] ? E.FOCUS[k].ko : k} ${Math.round((v / tot(s.focusMonths)) * 100)}%`).join(", ");
    const st = Object.entries(s.styleMonths || {}).map(([k, v]) => `${E.STYLE[k] ? E.STYLE[k].ko : k} ${Math.round((v / tot(s.styleMonths)) * 100)}%`).join(", ");
    return `시간 배분(집중): ${f || "-"} / 씀씀이: ${st || "-"}`;
  }
  const TEND_FORMAT = `JSON 하나로:
{"type":"유형 이름(2~10자, 이 기록에만 맞는 구체적인 이름)","oneLine":"한 줄 요약",
 "traits":[{"name":"성향 이름","low":"반대쪽 끝(짧게)","high":"이쪽 끝(짧게)","score":0~100,"evidence":"근거가 된 결정 1~2개를 나이와 함께"}],
 "strengths":"강점 1~2문장","blindSpots":"놓치기 쉬운 점 1~2문장","roadmapFit":null}
- traits는 4~6개. 미리 정해진 성격 축이나 유형표(MBTI 등)를 쓰지 말고, 이 기록에서 실제로 드러나는 성향을 네가 직접 찾아서 이름 붙여.
- 처지(가난, 나라, 나이, 성별에 따른 제약)가 선택지를 좁혔다는 점을 감안해. 어쩔 수 없었던 선택과 자유롭게 고른 선택을 구분하고, 선택지가 여러 개였는데 고른 것에 더 무게를 둬.
- 직접 적은 행동(✍)은 그 사람의 성향이 가장 잘 드러나는 근거야.
- score는 low(0)에서 high(100) 쪽으로 얼마나 기울었는지.`;

  AI.tendency = async function (s, signal) {
    const p = E.prof(s.homeIso);
    const res = await ask(`실제 통계로 만든 인생 시뮬레이션 게임에서 한 플레이어가 한 인물의 일생을 살았어. 아래 결정 기록을 읽고, 이 플레이어가 이 인생에서 보여준 인생 성향을 네 판단으로 측정해 줘.

[인물] ${s.name}, ${p.ko} 출신 ${s.sex === "m" ? "남성" : "여성"}, ${s.startAge}살 시작, 집안 형편 나라 안 하위 ${Math.round(s.fam.u * 100)}%${s.death ? `, ${Math.floor(s.death.age)}살에 ${E.C.causes[s.death.cause]}(으)로 사망` : ""}.
${timeShares(s)}

[결정 기록]
${decisionsText(s.history)}
${s.plan ? `\n[플레이어가 시작 전에 적은 인생 로드맵]\n${s.plan.slice(0, 1200)}\n` : ""}
${TEND_FORMAT}${s.plan ? `\n- roadmapFit: 로드맵과 이 성향의 궁합, 로드맵대로 가려면 무엇이 걸림돌이 될지 2~3문장.` : ""}`, signal);
    return normTend(res);
  };
  function normTend(res) {
    const traits = (Array.isArray(res.traits) ? res.traits : []).slice(0, 6).map((t) => ({
      name: String(t.name || "").slice(0, 20), low: String(t.low || "").slice(0, 14), high: String(t.high || "").slice(0, 14),
      score: Math.max(0, Math.min(100, +t.score || 50)), evidence: String(t.evidence || "").slice(0, 200),
    })).filter((t) => t.name);
    return {
      type: String(res.type || "").slice(0, 20), oneLine: String(res.oneLine || "").slice(0, 160), traits,
      strengths: String(res.strengths || "").slice(0, 300), blindSpots: String(res.blindSpots || "").slice(0, 300),
      roadmapFit: res.roadmapFit ? String(res.roadmapFit).slice(0, 500) : null, consistency: res.consistency ? String(res.consistency).slice(0, 400) : null,
    };
  }
  // the player, read across several lives lived in different places and circumstances
  AI.playerTendency = async function (past, plan, signal) {
    const lives = past.slice(-10).map((L, i) => `## 인생 ${i + 1}: ${L.name}, ${L.ko} ${L.sex === "m" ? "남성" : "여성"}, 형편 나라 안 하위 ${L.u}%, ${L.age}살에 사망(${L.cause})\n${L.time || ""}\n${decisionsText(L.decisions || [], 25)}`).join("\n\n");
    const res = await ask(`실제 통계로 만든 인생 시뮬레이션 게임을 한 플레이어가 여러 번 했어. 매번 다른 나라, 다른 집에 태어나 다른 처지에서 결정을 내렸어. 이 기록 전체를 읽고, 게임 속 인물이 아니라 '플레이어 본인'의 인생 성향을 네 판단으로 측정해 줘. 처지가 달라도 반복해서 나타나는 선택 습관이 가장 중요한 근거야.

${lives}
${plan ? `\n[플레이어가 적은 자신의 실제 인생 로드맵]\n${plan.slice(0, 1200)}\n` : ""}
${TEND_FORMAT}
- 추가: "consistency": 처지가 달라져도 일관된 점과 처지에 따라 바뀐 점 2~3문장.${plan ? `\n- roadmapFit: 이 성향으로 저 로드맵을 걸어갈 때의 강점과 걸림돌 3~4문장. 단정하지 말고 게임 기록에서 본 것임을 밝혀.` : ""}`, signal);
    return normTend(res);
  };

  AI.memoir = async function (s, tend, onText, signal) {
    const sum = E.summary(s);
    const lines = s.log.filter((e) => e.k !== "flavor").map((e) => `${e.age}살(${e.y}): ${e.t}`);
    const keep = lines.length > 140 ? lines.slice(0, 20).concat(["..."], lines.slice(-120)) : lines;
    const p = E.prof(s.homeIso);
    const prompt = `실제 통계로 만든 인생 시뮬레이션 게임에서 한 사람의 일생이 끝났어. 아래 기록으로 회고록을 써 줘.

[사람] ${s.name}, ${p.ko} 출신 ${s.sex === "m" ? "남성" : "여성"}, ${s.startAge}살에 게임 시작, ${s.death ? Math.floor(s.death.age) + "살에 " + E.C.causes[s.death.cause] + "(으)로 사망" : "생존"}.
[비교] 같은 나라·성별 14살의 예상 수명(UN WPP 2024 전망) ${sum.e14.toFixed(1)}세. 같은 또래 중 ${Math.round(sum.pctOutlived * 100)}%보다 오래 살았음. 생애 최고 소득 위치: 세계 상위 ${Math.max(1, Math.round(100 - sum.peakWorld))}%.
${tend ? `[이 인생에서 드러난 성향] ${tend.type}: ${tend.oneLine}` : ""}
[일생 기록]
${keep.join("\n")}
${s.plan ? `\n[플레이어가 시작 전에 적은 인생 로드맵]\n${s.plan.slice(0, 1200)}\n` : ""}
한국어로, 마크다운 기호(#, *) 없이 써 줘.

먼저 ${s.name}의 목소리로 쓴 1인칭 회고 9~13문장. 기록에 있는 구체적인 일(장소, 사람 이름, 직업, 상실)을 살리고, 그 나라와 시대의 현실이 느껴지게. 감상적인 미화 없이 담담하게.
${s.plan ? `그다음 빈 줄 하나, '계획과 실제'라고 쓰고, 플레이어의 로드맵과 이 인생에서 실제로 일어난 일을 4~6문장으로 비교해 줘. 계획대로 된 것, 통계적으로 어려웠던 지점(진학률, 실업률, 이주 성공률 같은), 선택의 영향. 게임 속 한 번의 결과라는 점을 잊지 말고 단정하지 말 것.` : ""}`;
    const r = await AI.sample(prompt, { modelTier: "default", onText, signal });
    return r.text;
  };

  G.LIFE_AI = AI;
})(typeof window !== "undefined" ? window : globalThis);
