// Screens: start -> birth -> play -> end. Plain DOM, one delegated click handler.
(function (G) {
  const E = G.LIFE_ENGINE, AI = G.LIFE_AI, C = E.C, D = E.D;
  const app = document.getElementById("app");
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const store = {
    get(k, d) { try { const v = localStorage.getItem("randomlife:" + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("randomlife:" + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem("randomlife:" + k); } catch (e) { /* ignore */ } },
  };
  const YEAR_MS = 50000; // one year of life at 1x
  const UI = { screen: "start", s: null, speed: store.get("speed", 1), timer: null, acc: 0, last: 0, tab: "life", plan: store.get("plan", ""), sheet: null, ctl: null, customOpen: false };
  G.LIFE_UI = UI;

  const pct = (x, d = 0) => (x * 100).toFixed(d) + "%";
  const korNum = (n) => {
    n = Math.round(n);
    if (n >= 1e8) { const a = Math.floor(n / 1e8), b = Math.round((n % 1e8) / 1e4); return `${a}억${b ? " " + b.toLocaleString("ko-KR") + "만" : ""}`; }
    if (n >= 1e4) return `${Math.round(n / 1e4).toLocaleString("ko-KR")}만`;
    return n.toLocaleString("ko-KR");
  };
  const sexWord = (s) => (s.sex === "m" ? "남자" : "여자");
  const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1); return w + ((c - 0xac00) % 28 && c >= 0xac00 && c <= 0xd7a3 ? a : b); };

  // ---------- start ----------
  function renderStart() {
    UI.screen = "start";
    stopClock();
    const saved = store.get("cur", null);
    const past = store.get("past", []);
    const ptend = store.get("playerTend", null);
    const isos = Object.keys(D.c).sort((a, b) => E.prof(a).ko.localeCompare(E.prof(b).ko, "ko"));
    app.innerHTML = `
      <section class="start">
        <div class="eyebrow">2026년 · 전 세계 14살</div>
        <h1>랜덤 인생</h1>
        <div><div class="count">${korNum(D.p14 * 1000)}명</div><div class="muted small">지금 이 순간 열네 살인 사람의 수 (UN 세계인구전망 2024)</div></div>
        <p class="lede">그중 한 명으로 깨어납니다. 어느 나라, 어떤 집에서 태어날지는 실제 인구 비율대로 정해져요. 학교, 일, 결혼, 병, 죽음까지 그 나라의 실제 통계를 따라 흘러가고, 중요한 순간마다 당신이 고릅니다. 1년은 약 1분이에요.</p>
        <div class="field">
          <label for="plan">내가 가보고 싶은 인생 로드맵 (선택) · 끝나면 실제로 살아본 결과와 비교해 줘요</label>
          <textarea id="plan" placeholder="예: 공대에 가서 개발자로 일하다가 서른 전에 창업, 마흔에는 해외에서 살기">${esc(UI.plan)}</textarea>
        </div>
        <div class="actions">
          <button class="btn primary" data-act="random">무작위로 태어나기</button>
          <button class="btn" data-act="toggle-custom" aria-expanded="${UI.customOpen}">내 조건으로 살아보기</button>
          ${saved ? `<button class="btn quiet" data-act="resume">이어하기 · ${esc(saved.name)}, ${Math.floor(saved.age)}살</button>` : ""}
        </div>
        <form class="custom" id="custom" ${UI.customOpen ? "" : "hidden"}>
          <div class="field wide"><label for="c-iso">나라</label><select id="c-iso">${isos.map((k) => `<option value="${k}" ${k === "KOR" ? "selected" : ""}>${esc(E.prof(k).ko)}</option>`).join("")}</select></div>
          <div class="field"><label for="c-sex">성별</label><select id="c-sex"><option value="m">남자</option><option value="f">여자</option></select></div>
          <div class="field"><label for="c-age">나이</label><input id="c-age" type="number" min="14" max="60" value="20"></div>
          <div class="field"><label for="c-wealth">집안 형편 (나라 안)</label><select id="c-wealth"><option value="1">하위 20%</option><option value="2">하위 20~40%</option><option value="3" selected>중간</option><option value="4">상위 20~40%</option><option value="5">상위 20%</option></select></div>
          <div class="field"><label for="c-urban">사는 곳</label><select id="c-urban"><option value="1">도시</option><option value="0">농촌</option></select></div>
          <div class="field"><label for="c-edu">최종 학력</label><select id="c-edu">${E.EDU.map((e, i) => `<option value="${i}" ${i === 3 ? "selected" : ""}>${e}</option>`).join("")}</select></div>
          <div class="field"><label for="c-status">지금 하는 일</label><select id="c-status"><option value="student">학생 (나이에 맞는 학교)</option><option value="none">일 없음·구직 중</option>${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => `<option value="${k}">${C.iscoName[k]}</option>`).join("")}</select></div>
          <div class="field"><label for="c-married">결혼</label><select id="c-married"><option value="0">미혼</option><option value="1">기혼</option></select></div>
          <div class="field"><label for="c-kids">자녀 수</label><input id="c-kids" type="number" min="0" max="8" value="0"></div>
          <div class="field"><label for="c-sav">저축 (월 생활비 몇 달치)</label><input id="c-sav" type="number" min="0" max="240" value="3"></div>
          <div class="wide"><button class="btn primary" type="submit">이 조건으로 시작</button></div>
        </form>
        ${past.length ? `<div class="past"><div class="eyebrow">살아본 인생 ${past.length}번</div>${past.slice(-8).reverse().map((p) => `<div class="past-row"><span class="code">${p.iso}</span><span>${esc(p.name)} · ${p.age}살 · ${esc(p.cause)}</span><span class="muted">${esc(p.type || "")}</span></div>`).join("")}</div>` : ""}
        ${past.length >= 2 ? `<div class="me-tend"><div class="section-h">나의 인생 성향</div><p class="note">여러 나라, 여러 처지에서 내린 결정을 모아 Claude가 게임 속 인물이 아닌 나 자신의 성향을 읽어요.</p><div id="ptend">${ptend ? tendHTML(ptend.res, `인생 ${ptend.n}번 기준`) : ""}</div>${AI.sample ? `<button class="btn" data-act="ptend">${ptend ? `다시 측정하기 (인생 ${past.length}번)` : `Claude에게 내 성향 측정받기 (인생 ${past.length}번)`}</button>` : `<p class="note">claude.ai에서 열면 측정할 수 있어요.</p>`}</div>` : ""}
        <div class="sources">데이터: UN 세계인구전망 2024 (14세 인구, 연령별 사망률 2026~2100, 출산율), WHO 세계보건추정 2023 (나라·나이·성별 사망원인), 세계은행 세계개발지표 (소득 분포, 교육, 노동, 보건, 결혼 등 80여 개), ILO (직업 분포, 직업별 임금). 돈은 2026년 물가 기준 현지 화폐로 보여줘요. 통계가 없는 나라·지표는 같은 지역·소득 수준의 중앙값으로 채웠어요.</div>
      </section>`;
  }

  function customFromForm() {
    const v = (id) => document.getElementById(id).value;
    const st = v("c-status");
    const age = Math.max(14, Math.min(60, +v("c-age") || 20));
    return {
      iso: v("c-iso"), sex: v("c-sex"), age, wealth: +v("c-wealth"), urban: v("c-urban") === "1", edu: +v("c-edu"),
      student: st === "student", isco: /^\d$/.test(st) ? +st : null, married: v("c-married") === "1",
      kids: +v("c-kids") || 0, savingsMonths: +v("c-sav") || 0,
    };
  }

  // ---------- birth ----------
  function renderBirth(s) {
    UI.screen = "birth";
    const p = E.prof(s.iso), d = D.c[s.iso];
    const share = (d.p[0] + d.p[1]) / D.p14;
    const sexShare = d.p[s.sex === "m" ? 0 : 1] / D.p14;
    const e0 = d.e0[s.sex === "m" ? 0 : 1];
    const coh = s.startAge + E.survivalMean(s.iso, s.sex, s.startAge, D.year);
    app.innerHTML = `
      <section class="birth">
        <div class="eyebrow">${s.mode === "custom" ? "내 조건으로" : "추첨 결과"}</div>
        <div class="roulette" id="roulette">…</div>
        <div id="reveal" hidden>
          <div class="idcard">
            <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap"><span class="code">${s.iso}</span><span class="name">${esc(s.name)}</span><span class="muted">${sexWord(s)} · ${Math.floor(s.age)}살</span></div>
            <div class="idgrid">
              <div><span class="eyebrow">사는 곳</span><b>${esc(p.ko)} ${esc(s.place)}</b></div>
              <div><span class="eyebrow">집안 형편</span><b>나라 안 하위 ${Math.round(s.fam.u * 100)}%</b><span class="small muted">세계 상위 ${Math.max(1, Math.round(100 - E.worldPct(s.fam.pcDay)))}%</span></div>
              <div><span class="eyebrow">기대 수명</span><b>${e0.toFixed(1)}세</b><span class="small muted">${p.ko} ${s.sex === "m" ? "남성" : "여성"}, 2026년 기준</span></div>
              <div><span class="eyebrow">내 또래 전망</span><b>${coh.toFixed(1)}세</b><span class="small muted">앞으로의 개선 반영 (UN)</span></div>
              <div><span class="eyebrow">종교</span><b>${esc(s.fam.rel)}</b></div>
              <div><span class="eyebrow">화폐</span><b>${esc(p.cur)}</b></div>
            </div>
            ${s.mode === "random" ? `<div class="odds">전 세계 14살 중 ${pct(share, share < 0.01 ? 2 : 1)}가 ${esc(p.ko)}에 살아요. ${esc(p.ko)}의 14살 ${s.sex === "m" ? "남자" : "여자"}아이는 약 ${Math.round(1 / sexShare).toLocaleString("ko-KR")}명 중 1명이에요.</div>` : ""}
          </div>
          <div class="childhood">${s.childLines.map((t) => `<div>${esc(t)}</div>`).join("")}</div>
          <div class="actions" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:18px">
            <button class="btn primary" data-act="begin">${Math.floor(s.age)}살부터 살아보기</button>
            <button class="btn quiet" data-act="home">다시 고르기</button>
          </div>
        </div>
      </section>`;
    const el = document.getElementById("roulette");
    const isos = Object.keys(D.c);
    const reduce = G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let n = 0;
    const finish = () => { el.textContent = `${p.ko}, ${s.place}`; el.classList.add("done"); document.getElementById("reveal").hidden = false; };
    if (reduce || s.mode === "custom") return finish();
    const spin = () => {
      if (UI.screen !== "birth") return;
      if (n++ > 16) return finish();
      let r = Math.random() * D.p14, k = isos[0];
      for (const iso of isos) { r -= D.c[iso].p[0] + D.c[iso].p[1]; if (r <= 0) { k = iso; break; } }
      el.textContent = E.prof(k).ko;
      setTimeout(spin, 45 + n * 5);
    };
    spin();
  }

  // ---------- play ----------
  function renderPlay() {
    UI.screen = "play";
    const s = UI.s;
    app.innerHTML = `
      <div class="top">
        <div class="idline">
          <span class="code" id="h-iso"></span><span class="who" id="h-name"></span><span class="age" id="h-age"></span><span class="muted mono" id="h-year"></span>
          <span class="spacer"></span>
          <div class="speed" role="group" aria-label="속도">
            <button class="chip" data-act="pause" id="b-pause" aria-pressed="false">일시정지</button>
            ${[0.5, 1, 2, 4].map((x) => `<button class="chip" data-act="speed" data-v="${x}" aria-pressed="${UI.speed === x}">${x}×</button>`).join("")}
          </div>
        </div>
        <div class="clock"><div class="months" id="h-months">${"<i></i>".repeat(12)}</div></div>
        <div class="stats" id="h-stats"></div>
        <div class="moneyline" id="h-money"></div>
      </div>
      <div class="spine" id="spine"></div>
      <div class="controls">
        <div class="ctrlrow"><span class="eyebrow">집중</span>${Object.entries(E.FOCUS).map(([k, f]) => `<button class="chip" data-act="focus" data-v="${k}" aria-pressed="${s.focus === k}">${f.ko}</button>`).join("")}</div>
        <div class="ctrlrow"><span class="eyebrow">씀씀이</span>${Object.entries(E.STYLE).map(([k, f]) => `<button class="chip" data-act="style" data-v="${k}" aria-pressed="${s.style === k}">${f.ko}</button>`).join("")}</div>
        <div class="actbox" id="actbox"></div>
      </div>
      <div class="tabs" role="tablist">
        ${[["life", "인생"], ["me", "나"], ["money", "가계부"], ["dec", "결정"]].map(([k, t]) => `<button role="tab" data-act="tab" data-v="${k}" aria-selected="${UI.tab === k}">${t}</button>`).join("")}
      </div>
      <div id="tabbody"></div>
      <div id="sheet"></div>`;
    renderTab();
    updateTop();
    renderActBox();
    if (s.pending) openSheet(s.pending); else startClock();
  }
  function renderActBox() {
    const el = document.getElementById("actbox");
    if (!el) return;
    const open = UI.s.threads.filter((t) => !t.done);
    el.innerHTML = AI.sample ? `
      <label class="small muted" for="act-text">✍ 직접 행동 · 선택지에 없는 일도 적으면 Claude가 이 나라 현실에 맞춰 이야기를 만들어요</label>
      <div class="row"><textarea id="act-text" maxlength="400" placeholder="예: 주말마다 코딩을 독학한다 / 모은 돈으로 작은 식당을 차린다"></textarea><button class="btn" data-act="do-act">하기</button></div>
      <div id="act-msg" class="thinking"></div>
      ${open.length ? `<div class="small muted">이어지는 이야기: ${open.map((t) => esc(t.title)).join(" · ")}</div>` : ""}` : `<div class="note">claude.ai에서 열면 선택지에 없는 행동을 직접 적어 Claude와 이야기를 만들어갈 수 있어요.</div>`;
  }

  function updateTop() {
    const s = UI.s;
    if (!s || UI.screen !== "play") return;
    const p = E.prof(s.iso);
    document.getElementById("h-iso").textContent = s.iso;
    document.getElementById("h-name").textContent = s.name;
    document.getElementById("h-age").textContent = Math.floor(s.age) + "세";
    document.getElementById("h-year").textContent = s.year + "년";
    document.querySelectorAll("#h-months i").forEach((el, i) => el.classList.toggle("on", i <= s.month));
    const st = [["health", "건강"], ["happy", "행복"], ["smarts", "지식"], ["social", "관계"]];
    document.getElementById("h-stats").innerHTML = st.map(([k, lab]) => {
      const v = Math.round(s.st[k]);
      const extra = k === "health" ? ` <span class="muted">/또래 ${Math.round(E.healthNorm(s.age))}</span>` : "";
      return `<div class="stat"><div class="lab">${lab}<span><b>${v}</b>${extra}</span></div><div class="bar ${v < 30 ? "low" : ""}"><i style="width:${v}%"></i></div></div>`;
    }).join("");
    const inc = E.householdIncome(s);
    const world = E.worldPct(E.perCapitaPPP(s));
    document.getElementById("h-money").innerHTML = `
      <span>저축 <b>${esc(E.money(s, s.savings))}</b></span>
      ${s.debt > 1 ? `<span>빚 <b>${esc(E.money(s, s.debt))}</b></span>` : ""}
      ${s.indep ? `<span>가구 월수입 <b>${esc(E.money(s, inc))}</b></span>` : s.job ? `<span>벌이 월 <b>${esc(E.money(s, s.job.pay))}</b></span>` : `<span>용돈 월 <b>${esc(E.money(s, E.pocket(s)))}</b></span>`}
      <span>세계 소득 <b>상위 ${Math.max(1, Math.round(100 - world))}%</b></span>`;
    renderSpine();
  }

  function renderSpine() {
    const s = UI.s;
    const el = document.getElementById("spine");
    if (!el) return;
    const curve = E.cohortCurve(s);
    const a0 = curve[0][0], a1 = 105;
    const X = (a) => ((a - a0) / (a1 - a0)) * 600;
    const Y = (v) => 4 + (1 - v) * 52;
    const pts = curve.map(([a, v]) => `${X(a).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
    const age = s.age;
    const alive = E.survival(s.homeIso, s.sex, s.startAge, age, D.year);
    const risk = E.annualRisk(s);
    const coh = s.startAge + E.survivalMean(s.homeIso, s.sex, s.startAge, D.year);
    el.innerHTML = `
      <svg viewBox="0 0 600 60" preserveAspectRatio="none" aria-hidden="true">
        <polygon points="0,56 ${pts} 600,56" fill="var(--accent-soft)"></polygon>
        <polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="1.5" vector-effect="non-scaling-stroke"></polyline>
        <line x1="${X(age).toFixed(1)}" y1="0" x2="${X(age).toFixed(1)}" y2="60" stroke="var(--ink)" stroke-width="1.5" vector-effect="non-scaling-stroke"></line>
      </svg>
      <div class="cap">같은 해 ${esc(E.prof(s.homeIso).ko)} ${s.sex === "m" ? "남자" : "여자"} ${Math.floor(s.startAge)}살 100명 중 <b class="mono">${Math.round(alive * 100)}</b>명이 지금 나이까지 살아 있어요 · 또래 예상 수명 <span class="mono">${coh.toFixed(0)}</span>세 · 나의 올해 사망 위험 <span class="mono">${(risk * 100).toFixed(risk < 0.01 ? 2 : 1)}%</span> <span class="src">UN WPP 2024</span></div>`;
  }

  // ---------- tabs ----------
  function renderTab() {
    const body = document.getElementById("tabbody");
    if (!body) return;
    const s = UI.s;
    if (UI.tab === "life") {
      body.innerHTML = `<div class="feed" id="feed"></div>`;
      UI.feedYear = null;
      const start = Math.max(0, s.log.length - 400);
      appendFeed(s.log.slice(start));
      scrollFeed(true);
    } else if (UI.tab === "me") body.innerHTML = meHTML(s);
    else if (UI.tab === "money") body.innerHTML = moneyHTML(s);
    else body.innerHTML = decHTML(s);
  }
  const KIND = { child: "", choice: "▸", loss: "†", death: "†", family: "♥", edu: "✎", work: "◆", money: "₩", move: "→", army: "★", health: "+", world: "◎", free: "✍", flavor: "·", life: "·" };
  // newest year on top; within a year, events read in order
  function appendFeed(list) {
    const feed = document.getElementById("feed");
    if (!feed) return;
    for (const e of list) {
      const key = e.k === "child" ? "child" : String(e.y);
      let g = feed.querySelector(`.grp[data-y="${key}"]`);
      if (!g) {
        g = document.createElement("div");
        g.className = "grp";
        g.dataset.y = key;
        g.innerHTML = e.k === "child" ? `<div class="yr"><b>0~${Math.floor(UI.s.startAge) - 1}살</b><span class="muted small">지금까지</span></div>` : `<div class="yr"><b>${e.y}</b><span class="muted small">${e.age}살</span></div>`;
        if (key === "child") feed.appendChild(g); else feed.insertBefore(g, feed.firstChild);
      }
      const d = document.createElement("div");
      d.className = "ev " + e.k;
      d.innerHTML = `<span class="k">${KIND[e.k] || "·"}</span><span class="t">${esc(e.t)}</span>`;
      g.appendChild(d);
    }
    const groups = feed.querySelectorAll(".grp:not([data-y=child])");
    for (let i = 60; i < groups.length; i++) groups[i].remove();
  }
  function scrollFeed() {}
  function kv(rows) { return `<dl class="kv">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>`; }
  function meHTML(s) {
    const p = E.prof(s.iso), d = D.c[s.iso];
    const parent = (x, w) => (x.alive ? `${w} ${x.age}세${x.job ? `, ${esc(x.job.title)}` : ""}` : `${w}: ${esc(C.causes[x.cause] || "병")}(으)로 별세`);
    const kids = s.kids.map((k) => `${esc(k.name)} (${k.alive ? s.year - k.born + "살" : "세상을 떠남"})`).join(", ");
    const conds = Object.keys(s.cond).map((k) => `${C.causes[k]}${s.cond[k].treated ? " (치료 중)" : " (방치)"}`).join(", ");
    const { sh } = E.causeWeights(s);
    const top = sh.map((v, i) => [D.causes[i], v]).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${C.causes[k]} ${(v / 10).toFixed(0)}%`).join(", ");
    const W = E.W;
    const n = (v, dgt = 0) => (v == null ? "자료 없음" : (+v).toFixed(dgt));
    return `<div class="panel">
      <div class="section-h">${esc(s.name)}</div>
      ${kv([
        ["사는 곳", `${esc(p.ko)} ${esc(s.place)} (${s.urban ? "도시" : "농촌"})${s.prevIso ? ` · ${esc(E.prof(s.homeIso).ko)}에서 이주` : ""}`],
        ["학력", `${E.EDU[s.edu.level]}${s.edu.inSchool ? " · 재학 중" : ""}${s.edu.major ? ` · ${C.majors[s.edu.major].ko}` : ""}${s.edu.elite ? ` · ${esc(p.elite)}` : ""}`],
        ["일", s.job ? `${esc(s.job.title)} · ${C.iscoName[s.job.isco]} · ${s.job.informal ? "비공식" : s.job.self ? "자영업" : "정규직"} · 월 ${esc(E.money(s, s.job.pay))}` : s.business ? `${esc(s.business.kind)} 운영 · 월 ${esc(E.money(s, s.business.monthly))}` : s.army && s.army.active ? "군 복무 중" : s.retired ? "은퇴" : s.looking ? "구직 중" : s.edu.inSchool ? "학생" : "없음"],
        ["배우자", s.partner ? `${esc(s.partner.name)} (${s.partner.alive ? s.partner.age + "세" : "사별"}) · ${s.partner.status === "married" ? "결혼" : "연애"}${s.partner.job ? ` · ${esc(s.partner.job.title)}` : ""}` : "없음"],
        ["자녀", kids || "없음"],
        ["부모", `${parent(s.fam.father, "아버지")}<br>${parent(s.fam.mother, "어머니")}`],
        ["형제", `${s.fam.sibs}명`],
        ["습관", [s.habit.smoke ? "흡연" : s.habit.quitAt != null ? "금연 중" : "비흡연", ["술 안 마심", "가끔 술", "과음"][s.habit.drink || 0], s.hobby ? "취미 있음" : ""].filter(Boolean).join(" · ")],
        ["앓는 병", conds || "없음"],
      ])}
      <div class="section-h">${esc(p.ko)}의 숫자</div>
      <div class="facts-list">
        <div>기대 수명 (2026): 남 ${d.e0[0]}세, 여 ${d.e0[1]}세 <span class="src">UN WPP</span></div>
        <div>합계출산율: ${d.tfr[0]}명 → 2050년 ${d.tfr[1]}명 <span class="src">UN WPP</span></div>
        <div>지금 내 나이·성별의 주요 사망원인: ${esc(top)} <span class="src">WHO GHE 2023</span></div>
        <div>1인당 GDP (구매력 기준): $${Math.round(d.gk).toLocaleString("ko-KR")} <span class="src">세계은행</span></div>
        <div>임금근로자 평균 월급: ${esc(E.money(s, E.meanEarnMonth(s.iso)))} <span class="src">ILO</span></div>
        <div>실업률 ${n(W(s.iso, "SL.UEM.TOTL.ZS"), 1)}% · 청년 실업률 ${n(W(s.iso, "SL.UEM.1524.ZS"), 1)}% <span class="src">ILO</span></div>
        <div>25세 이상 대졸자 ${n(W(s.iso, "SE.TER.CUAT.BA.ZS"), 1)}% · 대학 진학률 ${n(W(s.iso, s.sex === "m" ? "SE.TER.ENRR.MA" : "SE.TER.ENRR.FE"))}% <span class="src">UNESCO·세계은행</span></div>
        <div>하루 3달러 미만 빈곤 인구 ${n(W(s.iso, "SI.POV.DDAY"), 1)}% · 지니계수 ${n(W(s.iso, "SI.POV.GINI"), 1)} <span class="src">세계은행</span></div>
        <div>흡연율 (${s.sex === "m" ? "남" : "여"}) ${n(W(s.iso, s.sex === "m" ? "SH.PRV.SMOK.MA" : "SH.PRV.SMOK.FE"), 1)}% · 인터넷 사용 ${n(W(s.iso, "IT.NET.USER.ZS"))}% <span class="src">WHO·ITU</span></div>
      </div>
      <p class="note">통계가 없는 지표는 같은 지역·소득 수준 나라들의 중앙값으로 채웠어요.</p>
    </div>`;
  }
  function moneyHTML(s) {
    const inc = E.householdIncome(s);
    const need = E.needsMonth(s);
    const spend = s.indep ? s.spend || need : 0;
    const pc = E.perCapitaPPP(s);
    const food = Math.min(0.6, Math.max(0.1, 0.62 - 0.13 * Math.log(Math.max(1, pc) / 2)));
    const house = Math.min(0.3, 0.13 + 0.035 * Math.log(Math.max(1, pc)));
    const oop = (E.W(s.iso, "SH.XPD.OOPC.CH.ZS") || 30) / 100;
    const health = Math.min(0.1, 0.02 + oop * 0.06);
    const edu = s.kids.some((k) => k.alive && s.year - k.born >= 6 && s.year - k.born < 22) ? 0.07 : 0.02;
    const trans = 0.1;
    const other = Math.max(0.05, 1 - food - house - health - edu - trans);
    const parts = [["식비", food], ["주거", house], ["교통", trans], ["교육", edu], ["의료", health], ["옷·통신·여가", other]];
    const row = (k, v) => `<div class="budget-row"><span>${k}</span><div class="bar"><i style="width:${Math.round(v * 100)}%"></i></div><span class="mono">${esc(E.money(s, spend * v))}</span></div>`;
    const inv = s.invest && s.invest.stock ? s.invest.stock.v : 0;
    return `<div class="panel">
      ${s.indep ? `
      ${kv([
        ["내 수입", s.job ? esc(E.money(s, s.job.pay)) : s.business ? esc(E.money(s, s.business.monthly)) + " (사업)" : "없음"],
        ["배우자 수입", s.partner && s.partner.status === "married" && s.partner.alive ? esc(E.money(s, s.partner.pay || 0)) : "–"],
        ["연금·지원", s.pension ? esc(E.money(s, s.pension)) : "–"],
        ["가구 월수입", `<b>${esc(E.money(s, inc))}</b>`],
        ["기본 생활비", `${esc(E.money(s, need))} <span class="muted small">(식구 ${E.eqSize(s).toFixed(1)}명 기준)</span>`],
        ["한 달 지출", `<b>${esc(E.money(s, spend))}</b> · ${E.STYLE[s.style].ko}`],
        ["부모님께", s.parentSupport ? esc(E.money(s, s.parentSupport)) : "–"],
      ])}
      <div class="section-h">지출 구성 (추정)</div>
      <div class="budget">${parts.map(([k, v]) => row(k, v)).join("")}</div>
      <p class="note">소득이 낮을수록 식비 비중이 커지는 세계은행 국제비교프로그램(ICP)의 소비 구조 패턴을 따라 나눴어요.</p>` : `<p>아직 가족과 함께 살아요. 생활비는 집에서 나와요. 가족 한 사람당 하루 ${s.fam.pcDay.toFixed(1)}달러(구매력 기준)로 살아요.</p>`}
      <div class="section-h">자산</div>
      ${kv([
        ["저축", esc(E.money(s, s.savings))],
        ["주식·펀드", inv ? esc(E.money(s, inv)) : "–"],
        ["집", s.house ? esc(E.money(s, s.house.value)) : "–"],
        ["빚", s.debt > 1 ? esc(E.money(s, s.debt)) : "–"],
        ["나라 안 위치", `하위 ${Math.round((s.indep ? E.natPct(s) : s.fam.u) * 100)}%`],
        ["세계 위치", `상위 ${Math.max(1, Math.round(100 - E.worldPct(pc)))}% <span class="muted small">(한 사람당 하루 $${pc.toFixed(1)})</span>`],
      ])}
      <p class="note">금액은 2026년 물가 기준이에요. 예금은 예금금리에서 물가상승률을 뺀 실질 이자로 불어나요.</p>
    </div>`;
  }
  function decHTML(s) {
    if (!s.history.length) return `<div class="panel"><p class="muted">아직 내린 결정이 없어요. 중요한 순간이 오면 여기에 쌓이고, 언제든 그 순간으로 돌아가 다르게 고를 수 있어요.</p></div>`;
    return `<div class="panel"><p class="note">결정 직전으로 돌아가 다르게 골라볼 수 있어요. 그 뒤의 인생은 새로 흘러가요.</p><div class="timeline">${s.history.map((h, i) => `
      <div class="tl"><span class="mono muted">${h.age}세</span><span><b>${esc(h.title)}</b><br><span class="muted">${esc(h.label)}</span></span>${h.cp >= 0 ? `<button class="btn" data-act="rewind" data-v="${h.cp}">여기서 다시</button>` : ""}</div>`).join("")}</div></div>`;
  }

  // ---------- clock ----------
  function startClock() {
    stopClock();
    UI.last = performance.now();
    UI.timer = setInterval(tick, 120);
    const b = document.getElementById("b-pause");
    if (b) { b.setAttribute("aria-pressed", "false"); b.textContent = "일시정지"; }
  }
  function stopClock() {
    if (UI.timer) clearInterval(UI.timer);
    UI.timer = null;
  }
  function tick() {
    const now = performance.now();
    UI.acc += (now - UI.last) * UI.speed;
    UI.last = now;
    const per = YEAR_MS / 12;
    let guard = 0;
    while (UI.acc >= per && guard++ < 4) {
      UI.acc -= per;
      const r = E.step(UI.s);
      if (r.events.length && UI.tab === "life") { appendFeed(r.events); scrollFeed(); }
      if (UI.s.month === 0) save();
      if (r.dead) { stopClock(); updateTop(); setTimeout(renderEnd, 1600); return; }
      if (r.decision) { stopClock(); updateTop(); openSheet(r.decision); return; }
    }
    if (UI.acc > per * 4) UI.acc = 0;
    updateTop();
    if (UI.tab !== "life" && UI.s.month === 0) renderTab();
  }
  function save() {
    const s = UI.s;
    if (!s || s.dead) return;
    const copy = Object.assign({}, s, { _new: [] });
    store.set("cur", copy);
  }

  // ---------- decision sheet ----------
  function openSheet(dec) {
    const s = UI.s;
    UI.sheet = dec;
    const el = document.getElementById("sheet");
    const canFree = dec.free && AI.sample && dec.claude !== "thread";
    if (dec.claude === "thread" && AI.sample) {
      el.innerHTML = `
      <div class="sheet-wrap" role="dialog" aria-modal="true" aria-labelledby="dec-title">
        <div class="sheet" id="sheet-box">
          <div class="eyebrow">${dec.year}년 · ${dec.age}살 · 이어지는 이야기</div>
          <h2 id="dec-title">${esc(dec.title)}</h2>
          <p style="margin:0">${esc(dec.body)}</p>
          <div><button class="btn primary" data-act="scene">Claude에게 다음 장면 듣기</button></div>
          <div class="opts"><button class="opt" data-act="choose" data-v="drop"><b>이 일은 여기서 접는다</b></button></div>
          <div id="free-msg" class="thinking"></div>
        </div>
      </div>`;
      return;
    }
    if (dec.claude === "gen" && !AI.sample) {
      el.innerHTML = `<div class="sheet-wrap" role="dialog" aria-modal="true"><div class="sheet" id="sheet-box"><h2>${esc(dec.title)}</h2><p>이 장면은 Claude가 만든 이야기라 claude.ai에서만 이어갈 수 있어요.</p><div><button class="btn primary" data-act="drop-gen">이 이야기는 여기까지</button></div></div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="sheet-wrap" role="dialog" aria-modal="true" aria-labelledby="dec-title">
        <div class="sheet" id="sheet-box">
          <div class="eyebrow">${dec.year}년 · ${dec.age}살</div>
          <h2 id="dec-title">${esc(dec.title)}</h2>
          <p style="margin:0">${esc(dec.body)}</p>
          ${dec.facts && dec.facts.length ? `<div class="facts">${dec.facts.map((f) => `<div>${esc(f.t)}<span class="src">${esc(f.src)}</span></div>`).join("")}</div>` : ""}
          <div class="opts">${dec.options.map((o) => `<button class="opt" data-act="choose" data-v="${esc(o.key)}" ${o.disabled ? "disabled" : ""}><b>${esc(o.label)}</b>${o.hint ? `<span>${esc(o.hint)}</span>` : ""}</button>`).join("")}</div>
          ${canFree ? `<div class="free"><label class="small muted" for="free-text">✍ 기타 · 선택지에 없는 걸 직접 적으면 Claude가 이 나라 현실에 맞춰 이야기를 만들어요</label><textarea id="free-text" maxlength="400" placeholder="예: 학교는 계속 다니면서 주말에 시장에서 장사를 배운다"></textarea><div class="row"><button class="btn" data-act="free">이렇게 한다</button></div><div id="free-msg" class="thinking"></div></div>` : ""}
        </div>
      </div>`;
    const first = el.querySelector(".opt:not([disabled])");
    if (first) first.focus({ preventScroll: true });
  }
  function showOutcome(text, extra) {
    const box = document.getElementById("sheet-box");
    if (!box) return;
    box.innerHTML = `
      <div class="eyebrow">결과</div>
      ${extra || ""}
      <div class="outcome">${esc(text || "")}</div>
      <div><button class="btn primary" data-act="close-sheet">계속</button></div>`;
    const b = box.querySelector("[data-act=close-sheet]");
    if (b) b.focus({ preventScroll: true });
  }
  function closeSheet() {
    document.getElementById("sheet").innerHTML = "";
    UI.sheet = null;
    if (UI.s.dead) return renderEnd();
    if (UI.s.pending) return openSheet(UI.s.pending);
    if (UI.tab !== "life") renderTab();
    updateTop();
    renderActBox();
    startClock();
  }
  function choose(key) {
    const s = UI.s;
    if (s.pending && s.pending.claude === "gen") return genChoose(s.pending.options.find((o) => o.key === key).label, null);
    const r = E.choose(s, key);
    if (!r) return;
    if (UI.tab === "life") { appendFeed(r.events); scrollFeed(true); }
    save();
    showOutcome(r.text);
  }
  function claudeWait(msg, label) {
    UI.ctl = new AbortController();
    if (msg) msg.innerHTML = `${esc(label)} <button class="chip" data-act="stop-free">멈추기</button>`;
    document.querySelectorAll("#sheet .opt, #sheet [data-act=free], #sheet [data-act=scene]").forEach((b) => (b.disabled = true));
  }
  function claudeFail(e, msg) {
    const t = AI.errorText(e);
    if (msg) msg.textContent = t;
    document.querySelectorAll("#sheet .opt, #sheet [data-act=free], #sheet [data-act=scene]").forEach((b) => (b.disabled = false));
    document.querySelectorAll("#sheet .opt").forEach((b) => { const o = (UI.s.pending && UI.s.pending.options || []).find((x) => x.key === b.dataset.v); if (o && o.disabled) b.disabled = true; });
    if (!AI.sample) { const f = document.querySelector(".free"); if (f) f.remove(); }
  }
  async function scene() {
    const s = UI.s, dec = s.pending;
    const msg = document.getElementById("free-msg");
    const th = s.threads.find((x) => x.id === dec.threadId);
    claudeWait(msg, "Claude가 다음 장면을 쓰는 중이에요…");
    try {
      const gen = await AI.threadScene(s, th, UI.ctl.signal);
      if (UI.s !== s || s.pending !== dec) return;
      s.pending = gen;
      save();
      openSheet(gen);
    } catch (e) { claudeFail(e, msg); }
  }
  async function genChoose(label, text) {
    const s = UI.s, dec = s.pending;
    const msg = document.getElementById("free-msg");
    claudeWait(msg, "Claude가 결과를 만드는 중이에요…");
    try {
      const res = await AI.threadResolve(s, dec, text || label, UI.ctl.signal);
      if (UI.s !== s || s.pending !== dec) return;
      const r = E.chooseGenerated(s, label, text, res);
      if (UI.tab === "life") appendFeed(r.events);
      save();
      showOutcome(r.text, outcomeHead(res, text || label, r.ok));
    } catch (e) { claudeFail(e, msg); }
  }
  function outcomeHead(res, text, ok) {
    const chance = Math.max(0.01, Math.min(0.95, +res.chance || 0.3)) * (res.feasible === false ? 0.03 : 1);
    return `<div><b>${esc(res.summary || text)}</b></div><div class="small muted">Claude 판정: 성공 확률 약 ${Math.max(1, Math.round(chance * 100))}%${res.why ? ` · ${esc(res.why)}` : ""} → <b>${ok ? "성공" : "실패"}</b></div>`;
  }
  async function doAct() {
    const s = UI.s;
    const ta = document.getElementById("act-text");
    const msg = document.getElementById("act-msg");
    const text = (ta.value || "").trim();
    if (!text) { msg.textContent = "하고 싶은 일을 먼저 적어 주세요."; return; }
    if (s.pending || s.dead) return;
    stopClock();
    UI.ctl = new AbortController();
    msg.innerHTML = `Claude가 이 나라의 현실에 맞춰 이야기를 만드는 중이에요… <button class="chip" data-act="stop-free">멈추기</button>`;
    try {
      const res = await AI.act(s, text, UI.ctl.signal);
      if (UI.s !== s) return;
      const r = E.act(s, text, res);
      ta.value = "";
      msg.textContent = "";
      if (UI.tab === "life") appendFeed(r.events);
      save();
      document.getElementById("sheet").innerHTML = `<div class="sheet-wrap" role="dialog" aria-modal="true"><div class="sheet" id="sheet-box"></div></div>`;
      showOutcome(r.text, outcomeHead(res, text, r.ok));
      renderActBox();
    } catch (e) {
      msg.textContent = AI.errorText(e);
      if (!AI.sample) renderActBox();
      if (!s.pending) startClock();
    }
  }
  async function free() {
    const s = UI.s, dec = s.pending;
    const ta = document.getElementById("free-text");
    const msg = document.getElementById("free-msg");
    const text = (ta.value || "").trim();
    if (!text) { msg.textContent = "하고 싶은 행동을 먼저 적어 주세요."; return; }
    if (dec.claude === "gen") return genChoose(text, text);
    claudeWait(msg, "Claude가 이 나라의 현실에 맞춰 이야기를 만드는 중이에요…");
    try {
      const res = await AI.judge(s, dec, text, UI.ctl.signal);
      if (UI.s !== s || s.pending !== dec) return;
      const r = E.chooseFree(s, text, res);
      if (UI.tab === "life") appendFeed(r.events);
      save();
      showOutcome(r.text, outcomeHead(res, text, r.ok));
    } catch (e) { claudeFail(e, msg); }
  }

  // ---------- end ----------
  function tendHTML(t, note) {
    if (!t) return "";
    return `<div class="tend">
      <div class="arch">${esc(t.type)}</div>
      ${t.oneLine ? `<p style="margin:0">${esc(t.oneLine)}</p>` : ""}
      <div class="axes">${t.traits.map((x) => `
        <div class="trait"><div class="small"><b>${esc(x.name)}</b></div>
          <div class="axis"><span>${esc(x.low)}</span><div class="track"><i style="left:${x.score}%"></i></div><span>${esc(x.high)}</span></div>
          ${x.evidence ? `<div class="note">${esc(x.evidence)}</div>` : ""}</div>`).join("")}</div>
      ${t.consistency ? `<p class="small"><b>처지가 달라도</b> ${esc(t.consistency)}</p>` : ""}
      ${t.strengths ? `<p class="small"><b>강점</b> ${esc(t.strengths)}</p>` : ""}
      ${t.blindSpots ? `<p class="small"><b>놓치기 쉬운 점</b> ${esc(t.blindSpots)}</p>` : ""}
      ${t.roadmapFit ? `<p class="small"><b>내 로드맵과의 궁합</b> ${esc(t.roadmapFit)}</p>` : ""}
      ${note ? `<p class="note">Claude가 결정 기록을 읽고 측정했어요 · ${esc(note)}</p>` : `<p class="note">Claude가 이 인생의 결정 기록을 읽고 측정했어요.</p>`}
    </div>`;
  }
  function shares(o) {
    const tot = Object.values(o || {}).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(o || {}).map(([k, v]) => `${(E.FOCUS[k] || E.STYLE[k] || { ko: k }).ko} ${Math.round((v / tot) * 100)}%`).join(", ");
  }
  function recordLife(s, sum, cause) {
    if (s.recorded) return;
    s.recorded = true;
    const past = store.get("past", []);
    past.push({
      id: s.seed + ":" + s.year, name: s.name, iso: s.homeIso, ko: E.prof(s.homeIso).ko, sex: s.sex, age: Math.floor(sum.lived), cause, u: Math.round(s.fam.u * 100), year: s.year,
      time: `시간 배분(집중): ${shares(s.focusMonths)} / 씀씀이: ${shares(s.styleMonths)}`,
      decisions: s.history.map((h) => ({ age: h.age, title: h.title, body: h.body, opts: h.opts, label: h.label, ctx: h.ctx })),
      type: null,
    });
    store.set("past", past.slice(-30));
    store.del("cur");
  }
  function renderEnd() {
    UI.screen = "end";
    stopClock();
    const s = UI.s;
    const sum = E.summary(s);
    const p = E.prof(s.homeIso);
    const cause = s.death ? C.causes[s.death.cause] || s.death.cause : "";
    recordLife(s, sum, cause);
    const jobs = s.jobsHeld.concat(s.job ? [{ title: s.job.title, from: Math.floor(s.job.since), to: Math.floor(sum.lived) }] : []);
    const outlived = Math.round(sum.pctOutlived * 100);
    app.innerHTML = `
      <section class="end">
        <div class="eyebrow">${s.birthYear} – ${s.year} · ${esc(p.ko)}${s.prevIso ? ` → ${esc(E.prof(s.iso).ko)}` : ""}</div>
        <h1>${esc(s.name)}, ${Math.floor(sum.lived)}세에 ${esc(josa(cause, "으로", "로"))} 세상을 떠났어요.</h1>
        <p class="verdict">같은 해 ${esc(p.ko)}에서 열네 살이던 ${s.sex === "m" ? "남자" : "여자"}아이들 중 <b>${outlived}%</b>보다 오래 살았어요. 또래 예상 수명은 ${sum.e14.toFixed(1)}세였어요.</p>
        ${s.death && s.death.cause === "suicide" ? `<p class="note">실제로 마음이 힘들다면 혼자 견디지 않아도 돼요. 한국에서는 자살예방상담전화 109로 언제든 이야기할 수 있어요.</p>` : ""}
        <div class="tiles">
          <div class="tile"><span class="eyebrow">학력</span><b style="font-size:18px">${E.EDU[s.edu.level]}</b></div>
          <div class="tile"><span class="eyebrow">자녀</span><b>${sum.kids}</b><span class="small muted">${sum.kids !== sum.kidsAlive ? `${sum.kids - sum.kidsAlive}명을 먼저 보냄` : ""}</span></div>
          <div class="tile"><span class="eyebrow">가장 넉넉했을 때</span><b>상위 ${Math.max(1, Math.round(100 - sum.peakWorld))}%</b><span class="small muted">세계 소득 기준</span></div>
          <div class="tile"><span class="eyebrow">결정</span><b>${s.history.length}</b><span class="small muted">${s.rewound ? `되돌리기 ${s.rewound}번` : ""}</span></div>
        </div>
        ${jobs.length ? `<div><div class="section-h">한 일</div><div class="small">${jobs.map((j) => `${esc(j.title)} <span class="muted mono">${j.from}~${j.to == null ? "" : j.to}세</span>`).join(" · ")}</div></div>` : ""}
        <div>
          <div class="section-h">인생 성향과 회고록</div>
          <div id="analysis">${UI.tend && UI.tendFor === s.seed + ":" + s.year ? tendHTML(UI.tend) : ""}
          ${AI.sample ? `<button class="btn primary" data-act="analyze">Claude에게 성향 측정과 회고록 받기</button><p class="note">Claude가 이 인생에서 내린 결정 ${s.history.length}개(고를 수 있던 선택지, 실제로 고른 것, 직접 쓴 행동)를 읽고 성향을 직접 측정한 뒤, ${esc(s.name)}의 목소리로 회고록을 써요${s.plan ? ". 내 로드맵과도 비교해요" : ""}.</p>` : `<div class="memoir">${esc(localMemoir(s, sum))}</div><p class="note">claude.ai에서 열면 Claude가 결정 기록을 읽고 성향을 측정하고 회고록을 써줘요.</p>`}</div>
        </div>
        <div>
          <div class="section-h">다시 살아보기</div>
          ${decHTML(s)}
        </div>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn primary" data-act="random">새로운 인생</button>
          <button class="btn" data-act="same">같은 사람으로 처음부터</button>
          <button class="btn quiet" data-act="home">처음 화면</button>
        </div>
      </section>`;
    G.scrollTo({ top: 0 });
  }
  function localMemoir(s, sum) {
    const L = [];
    const p = E.prof(s.homeIso);
    L.push(`${s.birthYear}년 ${p.ko} ${s.place}에서 태어난 ${s.name}.`);
    L.push(`${E.EDU[s.edu.level]}까지 공부했고${s.jobsHeld.length ? `, ${s.jobsHeld.map((j) => j.title).slice(0, 3).join(", ")} 일을 했어요` : ""}.`);
    if (s.partner) L.push(`${s.partner.name}와(과) 함께했고, 아이는 ${s.kids.length}명이었어요.`);
    if (s.prevIso) L.push(`고향을 떠나 ${E.prof(s.iso).ko}에서 살았어요.`);
    if (s.death) L.push(`${Math.floor(sum.lived)}살에 ${C.causes[s.death.cause]}(으)로 삶을 마쳤어요.`);
    return L.join(" ");
  }
  async function analyze() {
    const s = UI.s;
    const box = document.getElementById("analysis");
    UI.ctl = new AbortController();
    box.innerHTML = `<p class="thinking">Claude가 결정 기록을 읽고 성향을 측정하는 중이에요… 보통 30초 안팎 걸려요. <button class="chip" data-act="stop-free">멈추기</button></p>`;
    let tend = null;
    try {
      tend = await AI.tendency(s, UI.ctl.signal);
      UI.tend = tend; UI.tendFor = s.seed + ":" + s.year;
      const past = store.get("past", []);
      const me = past.find((x) => x.id === s.seed + ":" + s.year);
      if (me) { me.type = tend.type; store.set("past", past); }
    } catch (e) {
      const t = AI.errorText(e);
      box.innerHTML = `<p class="note">${esc(t || "멈췄어요.")}</p>${AI.sample ? `<button class="btn" data-act="analyze">다시 받기</button>` : ""}`;
      return;
    }
    box.innerHTML = `${tendHTML(tend)}<div class="section-h" style="margin-top:14px">회고록</div><div class="memoir" id="memoir-text"><span class="thinking">회고록을 쓰는 중이에요…</span></div>`;
    const out = document.getElementById("memoir-text");
    UI.ctl = new AbortController();
    try {
      await AI.memoir(s, tend, ({ text }) => { out.textContent = text; }, UI.ctl.signal);
    } catch (e) {
      out.textContent = e && e.text ? e.text : localMemoir(s, E.summary(s));
      box.insertAdjacentHTML("beforeend", `<p class="note">${esc(AI.errorText(e))}</p>`);
    }
  }
  async function playerTend() {
    const box = document.getElementById("ptend");
    const past = store.get("past", []);
    UI.ctl = new AbortController();
    box.innerHTML = `<p class="thinking">Claude가 인생 ${past.length}번의 결정을 읽는 중이에요… <button class="chip" data-act="stop-free">멈추기</button></p>`;
    try {
      const res = await AI.playerTendency(past, UI.plan, UI.ctl.signal);
      store.set("playerTend", { n: past.length, res });
      box.innerHTML = tendHTML(res, `인생 ${past.length}번 기준`);
    } catch (e) {
      box.innerHTML = `<p class="note">${esc(AI.errorText(e) || "멈췄어요.")}</p>`;
    }
  }

  // ---------- start a life ----------
  function begin(opts) {
    UI.plan = (document.getElementById("plan") || { value: UI.plan }).value.trim();
    store.set("plan", UI.plan);
    UI.s = E.newLife(Object.assign({ plan: UI.plan }, opts));
    UI.tab = "life";
    UI.acc = 0;
    renderBirth(UI.s);
  }

  // ---------- events ----------
  app.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-act]");
    if (!t || t.disabled) return;
    const act = t.dataset.act, v = t.dataset.v;
    if (act === "random") begin({});
    else if (act === "same") begin({ seed: UI.s.seed, custom: UI.s.mode === "custom" ? UI.s.customOpts : undefined });
    else if (act === "toggle-custom") { UI.customOpen = !UI.customOpen; document.getElementById("custom").hidden = !UI.customOpen; t.setAttribute("aria-expanded", UI.customOpen); }
    else if (act === "resume") { const s = store.get("cur", null); if (s) { UI.s = s; s._new = []; renderPlay(); } }
    else if (act === "home") renderStart();
    else if (act === "begin") renderPlay();
    else if (act === "pause") {
      if (UI.timer) { stopClock(); t.setAttribute("aria-pressed", "true"); t.textContent = "계속"; }
      else if (!UI.s.pending) startClock();
    }
    else if (act === "speed") { UI.speed = +v; store.set("speed", UI.speed); document.querySelectorAll("[data-act=speed]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v)); }
    else if (act === "focus") { UI.s.focus = v; document.querySelectorAll("[data-act=focus]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v)); }
    else if (act === "style") { UI.s.style = v; document.querySelectorAll("[data-act=style]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === v)); }
    else if (act === "tab") { UI.tab = v; document.querySelectorAll("[data-act=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.v === v)); renderTab(); }
    else if (act === "choose") choose(v);
    else if (act === "close-sheet") closeSheet();
    else if (act === "free") free();
    else if (act === "stop-free") { if (UI.ctl) UI.ctl.abort(); }
    else if (act === "analyze") analyze();
    else if (act === "ptend") playerTend();
    else if (act === "do-act") doAct();
    else if (act === "scene") scene();
    else if (act === "drop-gen") { const th = UI.s.threads.find((x) => x.id === UI.s.pending.threadId); if (th) th.done = true; UI.s.pending = null; closeSheet(); }
    else if (act === "rewind") {
      if (t.dataset.armed !== "1") { t.dataset.armed = "1"; t.textContent = "정말 돌아가기"; return; }
      UI.s = E.rewind(UI.s, +v);
      UI.s.dead = false; UI.s.death = null; UI.s.recorded = false;
      UI.tab = "life";
      renderPlay();
    }
  });
  app.addEventListener("submit", (ev) => {
    if (ev.target.id !== "custom") return;
    ev.preventDefault();
    const c = customFromForm();
    begin({ custom: c });
    UI.s.customOpts = c;
  });
  app.addEventListener("input", (ev) => { if (ev.target.id === "plan") { UI.plan = ev.target.value; store.set("plan", UI.plan); } });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden && UI.timer) { stopClock(); UI.hiddenPaused = true; }
    else if (!document.hidden && UI.hiddenPaused && UI.screen === "play" && !UI.s.pending) { UI.hiddenPaused = false; startClock(); }
  });

  // keep a running game across an update of this page
  const hot = G.claude && G.claude.hot;
  if (hot && hot.snapshot) hot.snapshot(() => ({ s: UI.s, screen: UI.screen, tab: UI.tab }));
  function boot(data) {
    AI.init().then(() => {
      if (!AI.sample) return;
      if (UI.screen === "end") renderEnd();
      else if (UI.screen === "start") renderStart();
      else if (UI.screen === "play") { renderActBox(); if (UI.sheet) openSheet(UI.sheet); }
    });
    if (data && data.s && data.screen === "play") { UI.s = data.s; UI.s._new = []; UI.tab = data.tab || "life"; renderPlay(); }
    else renderStart();
  }
  if (hot && hot.ready) hot.ready(boot); else boot(hot && hot.data);
})(window);
