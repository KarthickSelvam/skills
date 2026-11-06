/* Interactive sequence explorer engine. Reads window.FLOW (see reference/data-schema.md). */
(function () {
  "use strict";
  const F = window.FLOW;
  const META = F.meta || {};
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const SVGNS = "http://www.w3.org/2000/svg";
  const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduce = mq.matches;
  if (mq.addEventListener) mq.addEventListener("change", e => { reduce = e.matches; });

  const STEP_W = 164, LANE_H = 70, FOLD_H = 28, PAD = 26, HOP = 16;
  const BASE_MS = 3400, ROUND_TRIP_X = 1.6;
  const T_SET = .14, T_RUN0 = .16, T_RUN1 = .86, T_MID = .51;

  const app = $("#app"), board = $("#board"), lanesEl = $("#lanes"), studsEl = $("#studs"), svg = $("#svg"), plate = $("#plate"), sr = $("#sr");
  const SEQ_KEYS = Object.keys(F.seqs);

  const state = { seq: SEQ_KEYS[0], idx: 0, t: 1, playing: false, oneShot: false, speed: 1, level: META.defaultLevel === "tech" ? "tech" : "plain", whatif: false, folded: new Set(), focus: false, view: "step", laneId: null };
  let raf = 0, last = 0, dwellUntil = 0;
  let geo = { y: {}, h: {}, height: 0, width: 0 };
  let els = { train: null, trainRect: null, trainText: null, routes: [], lamps: [], occ: [], bands: [] };

  /* ---------- model ---------- */
  function seq() { return F.seqs[state.seq]; }
  function steps() {
    const all = seq().steps, base = all.filter(s => !s.alt);
    if (!state.whatif) return base;
    const out = [];
    base.forEach(s => { out.push(s); all.filter(a => a.alt && a.after === s.id).forEach(a => out.push(a)); });
    return out;
  }
  function cur() { return steps()[state.idx]; }
  function kindOf(s) { return s.kind || (s.route.length === 1 ? "internal" : "request"); }
  function roundTrip(s) {
    if (s.roundTrip === false || s.route.length < 2) return false;
    if (s.roundTrip === true) return true;
    const k = kindOf(s);
    return !!s.res && k !== "response" && k !== "failure";
  }
  const tech = () => state.level === "tech";
  const stepLabel = s => tech() ? s.label : (s.labelPlain || s.label);
  const resLabel = s => tech() ? (s.resLabel || "reply") : (s.resLabelPlain || s.resLabel || "reply");
  const laneKind = id => tech() ? F.lanes[id].kind : (F.lanes[id].kindPlain || F.lanes[id].kind);
  const phaseOf = s => tech() ? s.phase : (s.phasePlain || (META.phasesPlain || {})[s.phase] || s.phase);

  /* ---------- geometry ---------- */
  function studH() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--stud-h")) || 86; }
  function layout() {
    let y = 0; const g = { y: {}, h: {}, height: 0 };
    seq().lanes.forEach(id => { const h = state.folded.has(id) ? FOLD_H : LANE_H; g.h[id] = h; g.y[id] = y + h / 2; y += h; });
    g.height = y + 12;
    g.width = PAD * 2 + steps().length * STEP_W;
    geo = g;
  }
  function colX(i) { return PAD + i * STEP_W + STEP_W / 2; }
  function pathPoints(s, i) {
    const x = colX(i), r = s.route, pts = [];
    if (r.length === 1) {
      const y = geo.y[r[0]], dy = Math.min(22, geo.h[r[0]] / 2 - 4);
      return [[x, y], [x + 40, y], [x + 40, y - dy], [x - 16, y - dy], [x - 16, y], [x, y]];
    }
    let cx = x - ((r.length - 2) * HOP) / 2;
    pts.push([cx, geo.y[r[0]]]);
    for (let k = 1; k < r.length; k++) {
      pts.push([cx, geo.y[r[k]]]);
      if (k < r.length - 1) { cx += HOP; pts.push([cx, geo.y[r[k]]]); }
    }
    return pts;
  }
  function polyLen(pts) { let L = 0; for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]); return L; }
  function pointAt(pts, f) {
    const L = polyLen(pts) * f; let acc = 0;
    for (let k = 1; k < pts.length; k++) {
      const seg = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      if (acc + seg >= L) { const u = seg ? (L - acc) / seg : 0; return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * u, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * u]; }
      acc += seg;
    }
    const p = pts[pts.length - 1]; return [p[0], p[1]];
  }
  const easeInOut = u => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  const clamp01 = v => Math.min(1, Math.max(0, v));

  /* ---------- helpers ---------- */
  function el(name, attrs, parent) {
    const n = document.createElementNS(SVGNS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  const d = pts => "M" + pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" L");
  function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function rich(v) { return esc(v).replace(/&lt;code&gt;/g, "<code>").replace(/&lt;\/code&gt;/g, "</code>"); }

  /* ---------- chrome (title, routes, hint, footnote) ---------- */
  function renderChrome() {
    document.title = META.title || "Sequence explorer";
    $("#hdrTitle").textContent = META.title || "";
    $("#hdrSub").textContent = META.subtitle || "";
    $("#footnote").textContent = META.footnote || "";
    $("#routes").innerHTML = SEQ_KEYS.map(k => {
      const s = F.seqs[k];
      return '<button class="route-plate" data-seq="' + esc(k) + '" aria-pressed="' + (k === state.seq) + '"><span class="rp-code">' + esc(s.code) + '</span><span class="rp-name">' + esc(s.title) + '</span><span class="rp-desc">' + esc(s.desc || "") + "</span></button>";
    }).join("");
    $("#kbdHint").innerHTML = "<kbd>Space</kbd> play <kbd>&larr;</kbd><kbd>&rarr;</kbd> step " + (SEQ_KEYS.length > 1 ? SEQ_KEYS.map(k => "<kbd>" + esc(F.seqs[k].code) + "</kbd>").join("") + " route " : "") + "<kbd>T</kbd> detail";
    const hasAlt = SEQ_KEYS.some(k => F.seqs[k].steps.some(s => s.alt));
    $("#whatifWrap").hidden = !hasAlt;
    $$("[data-level]").forEach(b => b.setAttribute("aria-pressed", b.dataset.level === state.level ? "true" : "false"));
  }

  /* ---------- render: board ---------- */
  function renderBoard() {
    layout();
    const st = steps(), s = cur();
    lanesEl.innerHTML = "";
    seq().lanes.forEach(id => {
      const L = F.lanes[id], folded = state.folded.has(id);
      const row = document.createElement("div");
      row.className = "lane" + (folded ? " folded" : "") + (s && s.route.includes(id) ? " active" : "");
      row.style.height = geo.h[id] + "px";
      row.setAttribute("role", "listitem");
      row.innerHTML =
        '<button class="lane-plate" data-lane="' + id + '" aria-label="' + esc(L.name) + ': what it is"><i class="lamp" data-lanelamp="' + id + '"></i><span style="min-width:0"><span class="lane-name">' + esc(L.name) + '</span><span class="lane-kind">' + esc(laneKind(id)) + '</span></span></button>' +
        '<button class="lane-fold" data-fold="' + id + '" aria-label="' + (folded ? "Unfold " : "Fold ") + esc(L.name) + ' track" aria-expanded="' + !folded + '"><svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"/></svg></button>';
      lanesEl.appendChild(row);
    });
    studsEl.innerHTML = "";
    studsEl.style.width = geo.width + "px";
    studsEl.style.paddingLeft = PAD + "px";
    st.forEach((stp, i) => {
      const b = document.createElement("button");
      b.className = "stud" + (stp.alt ? " alt" : "") + (i < state.idx ? " done" : "") + (i === state.idx ? " current" : "");
      b.style.width = STEP_W + "px";
      if (i === state.idx) b.setAttribute("aria-current", "step"); else b.tabIndex = -1;
      b.setAttribute("aria-label", "Step " + (i + 1) + ": " + stp.title);
      b.dataset.i = i;
      b.innerHTML = '<span class="stud-num">' + (stp.alt ? "!" : i + 1) + '</span><span class="stud-title">' + esc(stp.title) + "</span>";
      studsEl.appendChild(b);
    });
    svg.innerHTML = "";
    svg.setAttribute("width", geo.width);
    svg.setAttribute("height", geo.height);
    svg.setAttribute("viewBox", "0 0 " + geo.width + " " + geo.height);
    els = { routes: [], lamps: [], occ: [], bands: [] };
    const gBand = el("g", {}, svg), gTrk = el("g", {}, svg), gRoute = el("g", {}, svg), gLamp = el("g", {}, svg);
    st.forEach((stp, i) => els.bands.push(el("rect", { x: PAD + i * STEP_W, y: 0, width: STEP_W, height: geo.height, class: "col-band" }, gBand)));
    seq().lanes.forEach(id => {
      const y = geo.y[id], folded = state.folded.has(id);
      el("line", { x1: 0, y1: y, x2: geo.width, y2: y, class: folded ? "trk trk-folded" : "trk" }, gTrk);
      if (!folded) for (let i = 0; i <= st.length; i++) { const x = PAD + i * STEP_W; el("line", { x1: x, y1: y - 5, x2: x, y2: y + 5, class: "joint" }, gTrk); }
      els.occ.push({ id, line: el("line", { x1: 0, y1: y, x2: 0, y2: y, class: "trk-occ", opacity: 0 }, gTrk) });
    });
    st.forEach((stp, i) => {
      const pts = pathPoints(stp, i);
      const p = el("path", { d: d(pts), class: (stp.route.length === 1 ? "self-loop route" : "route") + (stp.alt ? " alt" : "") }, gRoute);
      els.routes.push({ path: p, pts, back: pts.slice().reverse() });
      const lamps = stp.route.map((id, k) => {
        const pt = stp.route.length === 1 ? pts[0] : (k === 0 ? pts[0] : pts.find((q, qi) => qi > 0 && Math.abs(q[1] - geo.y[id]) < .5 && (k === stp.route.length - 1 ? qi === pts.length - 1 : true)) || pts[pts.length - 1]);
        return el("circle", { cx: pt[0], cy: pt[1], r: state.folded.has(id) ? 4.5 : 7, class: "lmp" }, gLamp);
      });
      els.lamps.push(lamps);
    });
    const gT = el("g", { class: "train", opacity: 0 }, svg);
    el("circle", { r: 16, class: "train-glow" }, gT);
    els.trainRect = el("rect", { x: -28, y: -11, width: 56, height: 22, rx: 4 }, gT);
    els.trainText = el("text", { x: 0, y: 4, "text-anchor": "middle" }, gT);
    els.train = gT;
    applyFrame();
  }

  /* ---------- per-frame state ---------- */
  function lampClass(stp, k, t, kind, rt) {
    const n = stp.route.length;
    if (!rt) {
      const reach = n === 1 ? T_RUN0 : T_RUN0 + (T_RUN1 - T_RUN0) * (k / (n - 1));
      if (t < T_SET) return k === 0 ? " set" : "";
      if (t < reach) return " set";
      if (t < T_RUN1 && Math.abs(t - reach) < .12) return kind === "failure" ? " stop" : " occ";
      return (kind === "failure" && k === n - 1) ? " stop" : " done";
    }
    // Round trip: the request reaches each lamp on the way out, the reply passes it on the way back.
    const out = T_RUN0 + (T_MID - T_RUN0) * (k / (n - 1));
    const back = T_MID + (T_RUN1 - T_MID) * ((n - 1 - k) / (n - 1));
    if (t < T_SET) return k === 0 ? " set" : "";
    if (t < out) return " set";
    if (Math.abs(t - out) < .08 && t < T_MID) return " occ";
    if (Math.abs(t - back) < .08 && t < T_RUN1 + .04) return " ret";
    return " done";
  }
  function applyFrame() {
    const st = steps(), i = state.idx, s = st[i];
    if (!s) return;
    const t = state.t, kind = kindOf(s), rt = roundTrip(s);
    st.forEach((stp, j) => {
      let cls = (stp.route.length === 1 ? "self-loop route" : "route") + (stp.alt ? " alt" : "");
      if (j < i) cls += " past"; else if (j === i) cls += " set";
      els.routes[j].path.setAttribute("class", cls);
      els.bands[j].setAttribute("class", "col-band" + (j === i ? " on" : ""));
      els.lamps[j].forEach((lp, k) => {
        let c = "lmp";
        if (j < i) c += " past";
        else if (j === i) c += lampClass(stp, k, t, kind, rt && j === i);
        lp.setAttribute("class", c);
      });
    });
    const r = els.routes[i];
    const returning = rt && t >= T_MID;
    if (t >= T_RUN0 && t <= T_RUN1 + .08) {
      let p, label;
      if (!rt) { p = pointAt(r.pts, easeInOut(clamp01((t - T_RUN0) / (T_RUN1 - T_RUN0)))); label = stepLabel(s) || ""; }
      else if (!returning) { p = pointAt(r.pts, easeInOut(clamp01((t - T_RUN0) / (T_MID - T_RUN0)))); label = stepLabel(s) || ""; }
      else { p = pointAt(r.back, easeInOut(clamp01((t - T_MID) / (T_RUN1 - T_MID)))); label = resLabel(s); }
      const w = Math.max(44, label.length * 6.9 + 18);
      els.trainRect.setAttribute("x", -w / 2); els.trainRect.setAttribute("width", w);
      els.trainText.textContent = label;
      els.train.setAttribute("transform", "translate(" + p[0].toFixed(1) + " " + p[1].toFixed(1) + ")");
      els.train.setAttribute("class", "train" + (kind === "failure" ? " stop" : (kind === "response" || returning) ? " ret" : ""));
      els.train.setAttribute("opacity", t > T_RUN1 ? Math.max(0, 1 - (t - T_RUN1) / .08) : 1);
    } else els.train.setAttribute("opacity", 0);
    const x0 = PAD + i * STEP_W, x1 = x0 + STEP_W;
    els.occ.forEach(o => {
      const on = s.route.includes(o.id) && t > T_SET && t < 1;
      o.line.setAttribute("x1", x0); o.line.setAttribute("x2", x1);
      o.line.setAttribute("opacity", on ? 1 : 0);
      o.line.setAttribute("class", "trk-occ" + (returning ? " ret" : ""));
      o.line.style.stroke = kind === "failure" ? "var(--lamp-stop)" : "";
    });
    $$("[data-lanelamp]").forEach(lp => {
      const id = lp.dataset.lanelamp;
      lp.className = "lamp" + (s.route.includes(id) ? (t >= 1 ? (kind === "failure" ? " l-stop" : " l-done") : returning ? " l-ret" : " l-occ") : "");
    });
    $("#railFill").style.transform = "scaleX(" + ((i + clamp01(t)) / st.length).toFixed(4) + ")";
  }

  /* ---------- playback ---------- */
  function dur() { const s = cur(); return BASE_MS * (s && roundTrip(s) ? ROUND_TRIP_X : 1) / state.speed; }
  function dwell() { return (reduce ? 2600 : 1400) / state.speed + (state.level === "plain" ? 900 / state.speed : 0); }
  function tick(now) {
    raf = 0;
    const dt = Math.min(64, now - last); last = now;
    if (state.t < 1) {
      if (!(state.playing || state.oneShot)) return;
      state.t = Math.min(1, state.t + dt / dur());
      applyFrame();
      if (state.t >= 1) { state.oneShot = false; dwellUntil = now + dwell(); }
      raf = requestAnimationFrame(tick);
      return;
    }
    if (state.playing) {
      if (now < dwellUntil) { raf = requestAnimationFrame(tick); return; }
      if (state.idx < steps().length - 1) { go(state.idx + 1, true); return; }
      setPlaying(false);
    }
  }
  function run() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function setPlaying(p) {
    state.playing = p;
    if (!p) state.oneShot = false;
    app.classList.toggle("playing", p);
    $("#btnPlay").setAttribute("aria-label", p ? "Pause" : "Play");
    if (p) {
      if (state.t >= 1 && state.idx >= steps().length - 1) { go(0, true); return; }
      if (state.t >= 1) dwellUntil = 0;
      run();
    }
  }
  function go(i, animate) {
    const st = steps();
    i = Math.max(0, Math.min(st.length - 1, i));
    if (reduce) animate = false;
    const fk = focusKey();
    state.idx = i; state.view = "step";
    state.t = animate ? 0 : 1;
    state.oneShot = animate && !state.playing;
    if (state.focus) refocus();
    renderBoard(); renderPlate(); follow(); updateHash(); announce();
    restoreFocus(fk);
    if (animate) run();
    else if (state.playing) { dwellUntil = performance.now() + dwell(); run(); }
  }
  // Re-renders replace focused buttons; put keyboard focus back on the equivalent control.
  function focusKey() {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    if (a.matches(".stud")) return ".stud.current";
    for (const k of ["fold", "lane", "nav", "back"]) if (a.dataset && a.dataset[k] != null) return "[data-" + k + '="' + a.dataset[k] + '"]';
    if (a.dataset && a.dataset.goto != null) return "[data-back]";
    return null;
  }
  function restoreFocus(key) {
    if (!key) return;
    const n = $(key) || (key.startsWith("[data-nav") ? $(".p-title") : null);
    if (n) { if (n.matches(".p-title")) n.tabIndex = -1; n.focus({ preventScroll: true }); }
  }
  function follow() {
    const x = colX(state.idx), laneW = lanesEl.offsetWidth;
    const view = board.clientWidth - laneW;
    const opt = { behavior: reduce ? "auto" : "smooth" };
    const left = board.scrollLeft;
    if (x < left + 40 || x > left + view - 40 || state.idx === 0) opt.left = Math.max(0, x - view / 2);
    const s = cur();
    if (s) {
      const ys = s.route.map(id => geo.y[id] + studH());
      const top = Math.min(...ys) - 60, bot = Math.max(...ys) + 60;
      if (top < board.scrollTop || bot > board.scrollTop + board.clientHeight) opt.top = Math.max(0, top - 20);
    }
    if ("left" in opt || "top" in opt) board.scrollTo(opt);
  }
  function refocus() { const s = cur(); state.folded = new Set(seq().lanes.filter(id => !s.route.includes(id))); }
  function announce() {
    const s = cur(), pos = "Step " + (state.idx + 1) + " of " + steps().length;
    sr.textContent = pos + ": " + s.title;
    $("#posText").textContent = pos;
    $("#phaseText").textContent = (s.alt ? "What if · " : "") + s.title;
  }
  function updateHash() { history.replaceState(null, "", "#" + cur().id); }

  /* ---------- plate ---------- */
  function hl(body, lang) {
    const e = esc(body);
    if (lang === "json") {
      return e.replace(/(\/\/[^\n]*)/g, '<span class="j-c">$1</span>')
        .replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)/g, '<span class="j-k">$1</span>$2')
        .replace(/(:\s*|\[\s*|,\s*)(&quot;(?:[^&]|&(?!quot;))*?&quot;)/g, '$1<span class="j-s">$2</span>')
        .replace(/(:\s*)(-?\d+(?:\.\d+)?)/g, '$1<span class="j-n">$2</span>')
        .replace(/\b(true|false|null)\b/g, '<span class="j-l">$1</span>');
    }
    if (lang === "sql") {
      return e.replace(/(--[^\n]*)/g, '<span class="j-c">$1</span>')
        .replace(/\b(SELECT|INSERT INTO|UPDATE|DELETE FROM|SET|WHERE|FROM|JOIN|LEFT JOIN|ON|AND|OR|NOT EXISTS|EXISTS|IN|IS NULL|IS NOT NULL|ORDER BY|GROUP BY|LIMIT|FOR UPDATE SKIP LOCKED|FOR UPDATE|VALUES|RETURNING|ON CONFLICT|DO UPDATE|DO NOTHING|BEGIN|COMMIT|WITH|AS|DISTINCT)\b/g, '<span class="j-k">$1</span>')
        .replace(/('(?:[^'])*')/g, '<span class="j-s">$1</span>');
    }
    if (lang === "http") return e.replace(/^(GET|POST|PUT|PATCH|DELETE|HTTP\/1\.1[^\n]*)/gm, '<span class="j-k">$1</span>').replace(/^([A-Za-z-]+:)/gm, '<span class="j-n">$1</span>');
    return e;
  }
  function chev() { return '<span class="chev"><svg viewBox="0 0 12 12"><path d="M2 4l4 4 4-4"/></svg></span>'; }
  function section(title, count, inner, open) {
    return '<details class="sec"' + (open ? " open" : "") + '><summary><span>' + title + (count ? '<span class="cnt">' + esc(count) + "</span>" : "") + "</span>" + chev() + '</summary><div class="sec-body">' + inner + "</div></details>";
  }
  let copyBodies = [];
  function code(c) {
    copyBodies.push(c.body);
    return '<div class="codebox"><div class="cap"><span>' + esc(c.cap || "") + '</span><button class="copy" data-copy="' + (copyBodies.length - 1) + '">Copy</button></div><pre tabindex="0"><code>' + hl(c.body, c.lang) + "</code></pre></div>";
  }
  function tableCard(t, open) {
    let h = '<div class="tbl"><div class="tbl-h"><span class="tbl-name">' + esc(t.name) + '</span><span class="tbl-op">' + esc(t.op || "") + "</span></div>";
    if (t.cols && t.cols.length) h += '<ul class="tbl-cols">' + t.cols.map(c => "<li><code>" + esc(c[0]) + "</code><span>" + esc(c[1]) + "</span></li>").join("") + "</ul>";
    if (t.sql) h += '<details class="tbl-sql"' + (open ? " open" : "") + "><summary>SQL on " + esc(t.name) + "</summary>" + code({ cap: (t.op || "SQL") + " · " + t.name, lang: "sql", body: t.sql }) + "</details>";
    return h + "</div>";
  }
  function verbClass(v) { return { GET: "v-get", POST: "v-get", SQL: "v-sql", AWS: "v-aws", SDK: "v-sdk", IN: "v-in" }[v] || ""; }
  const KIND_LABEL = { request: "CALL", response: "REPLY", async: "SCHEDULED", internal: "IN-PROCESS", failure: "FAILURE BRANCH" };
  const KIND_PLAIN = { request: "REQUEST", response: "REPLY", async: "ON A TIMER", internal: "INSIDE ONE SYSTEM", failure: "WHAT IF" };

  function renderPlate() {
    copyBodies = [];
    if (state.view === "lane") return renderLane();
    const st = steps(), s = cur(), i = state.idx, isTech = tech(), kind = kindOf(s), rt = roundTrip(s);
    const stops = s.route.map(id => '<button class="p-stop" data-lane="' + id + '"><i class="lamp"></i>' + esc(F.lanes[id].name) + "</button>").join('<span class="p-arrow" aria-hidden="true">' + (rt ? "⇄" : "→") + "</span>");
    let h = '<div class="p-top"><span class="p-pos">STEP ' + (i + 1) + " OF " + st.length + (s.phase ? " · " + esc(phaseOf(s)).toUpperCase() : "") + '</span><span class="p-kind' + (s.alt ? " alt" : "") + '">' + (isTech ? KIND_LABEL : KIND_PLAIN)[kind] + "</span></div>";
    h += '<h2 class="p-title">' + esc(s.title) + "</h2>";
    h += '<div class="p-route">' + stops + "</div>";
    if (rt) h += '<p class="p-rt"><span><i>OUT</i><b>' + esc(stepLabel(s)) + "</b>" + esc(F.lanes[s.route[0]].name) + " → " + esc(F.lanes[s.route[s.route.length - 1]].name) + '</span><span class="back"><i>BACK</i><b>' + esc(resLabel(s)) + "</b>" + esc(F.lanes[s.route[s.route.length - 1]].name) + " → " + esc(F.lanes[s.route[0]].name) + "</span></p>";
    h += '<p class="p-story">' + rich(s.story) + "</p>";
    if (s.why) h += '<p class="p-why"><b>Why it matters:</b> ' + rich(s.why) + "</p>";
    const callLine = s.call ? '<div class="call"><span class="verb ' + verbClass(s.call.verb) + '">' + esc(s.call.verb) + "</span><span>" + esc(s.call.text) + "</span></div>" : "";
    const kv = s.kv ? '<dl class="kv">' + s.kv.map(p => "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>").join("") + "</dl>" : "";
    if (isTech) h += callLine;
    const secs = [];
    if (!isTech && (s.call || s.kv)) secs.push(section("The call", "", callLine + kv, false));
    else if (isTech && s.kv) secs.push(section("Details", s.kv.length + "", kv, true));
    if (s.req) secs.push(section(rt ? "Request (out)" : "Request", s.req.lang.toUpperCase(), code(s.req), isTech));
    if (s.res) secs.push(section(rt ? "Response (back)" : "Response", s.res.lang.toUpperCase(), code(s.res), isTech));
    if (s.tables && s.tables.length) {
      const nSql = s.tables.filter(t => t.sql).length;
      secs.push(section("Data and SQL", s.tables.map(t => t.name).join(", ") + (nSql ? " · " + nSql + " SQL" : ""), s.tables.map(t => tableCard(t, isTech)).join(""), isTech));
    }
    if (s.notes) secs.push(section("Rules and edge cases", s.notes.length + "", '<ul class="notes">' + s.notes.map(n => "<li>" + rich(n) + "</li>").join("") + "</ul>", isTech));
    if (s.refs) secs.push(section("Where it lives", "", '<div class="refs">' + s.refs.map(r => '<span class="ref">' + esc(r) + "</span>").join("") + "</div>", false));
    h += secs.join("");
    const pv = st[i - 1], nx = st[i + 1];
    h += '<div class="p-nav"><button data-nav="-1"' + (pv ? "" : " disabled") + ">← Previous<b>" + esc(pv ? pv.title : "Start") + '</b></button><button data-nav="1"' + (nx ? "" : " disabled") + ">Next →<b>" + esc(nx ? nx.title : "End of route") + "</b></button></div>";
    plate.innerHTML = h;
    plate.scrollTop = 0;
  }
  function renderLane() {
    const id = state.laneId, L = F.lanes[id], st = steps();
    const uses = st.map((s, i) => [s, i]).filter(p => p[0].route.includes(id));
    let h = '<div class="lane-card"><div class="p-top"><span class="p-pos">TRACK · ' + esc(laneKind(id)).toUpperCase() + '</span><button class="copy" data-back="1">Back to step ' + (state.idx + 1) + "</button></div>";
    h += '<h2 class="p-title">' + esc(L.name) + "</h2>";
    h += '<p class="p-story">' + rich(L.plain) + "</p>";
    if (L.tech && L.tech.length) h += section("Technical", L.tech.length + "", '<dl class="kv">' + L.tech.map(p => "<dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd>").join("") + "</dl>", tech());
    h += section("Steps on this track", uses.length + "", '<ul class="notes">' + uses.map(p => '<li><a href="#' + p[0].id + '" data-goto="' + p[1] + '">' + (p[1] + 1) + ". " + esc(p[0].title) + "</a></li>").join("") + "</ul>", true);
    if (L.store) {
      const byTable = {};
      uses.forEach(([s, i]) => (s.tables || []).forEach(t => { (byTable[t.name] = byTable[t.name] || []).push([s, i, t.op]); }));
      const names = Object.keys(byTable).sort();
      if (names.length) h += section("Tables on this track", names.length + "", names.map(n => '<div class="tbl"><div class="tbl-h"><span class="tbl-name">' + esc(n) + '</span></div><ul class="tbl-uses">' + byTable[n].map(([s, i, op]) => '<li><a href="#' + s.id + '" data-goto="' + i + '">' + (i + 1) + ". " + esc(op || "") + " · " + esc(s.title) + "</a></li>").join("") + "</ul></div>").join(""), false);
    }
    if (L.refs) h += section("Where it lives", "", '<div class="refs">' + L.refs.map(r => '<span class="ref">' + esc(r) + "</span>").join("") + "</div>", false);
    h += "</div>";
    plate.innerHTML = h; plate.scrollTop = 0;
  }

  /* ---------- events ---------- */
  function setSeq(sq) {
    if (!F.seqs[sq]) return;
    setPlaying(false);
    state.seq = sq; state.idx = 0; state.t = 1; state.folded = new Set(); state.focus = false;
    $("#focusLanes").setAttribute("aria-pressed", "false");
    $$(".route-plate").forEach(b => b.setAttribute("aria-pressed", b.dataset.seq === sq ? "true" : "false"));
    go(0, false);
    board.scrollTo({ left: 0, top: 0 });
  }
  function setLevel(lv) { const fk = focusKey(); state.level = lv; $$("[data-level]").forEach(b => b.setAttribute("aria-pressed", b.dataset.level === lv ? "true" : "false")); renderBoard(); renderPlate(); announce(); restoreFocus(fk); }

  renderChrome();
  $("#routes").addEventListener("click", e => { const b = e.target.closest(".route-plate"); if (b) setSeq(b.dataset.seq); });
  $$("[data-level]").forEach(b => b.addEventListener("click", () => setLevel(b.dataset.level)));
  $$("[data-speed]").forEach(b => b.addEventListener("click", () => { state.speed = +b.dataset.speed; $$("[data-speed]").forEach(x => x.setAttribute("aria-pressed", x === b ? "true" : "false")); }));
  $("#whatif").addEventListener("change", e => {
    const id = cur().id; state.whatif = e.target.checked;
    let i = steps().findIndex(s => s.id === id); if (i < 0) i = Math.min(state.idx, steps().length - 1);
    state.idx = i; if (state.focus) refocus(); renderBoard(); renderPlate(); announce(); follow(); updateHash();
  });
  $("#btnPlay").addEventListener("click", () => setPlaying(!state.playing));
  $("#btnNext").addEventListener("click", () => { setPlaying(false); go(state.idx + 1, true); });
  $("#btnPrev").addEventListener("click", () => { setPlaying(false); go(state.idx - 1, false); });
  $("#btnRestart").addEventListener("click", () => { setPlaying(false); go(0, false); board.scrollTo({ left: 0 }); });
  $("#focusLanes").addEventListener("click", e => {
    state.focus = !state.focus; e.currentTarget.setAttribute("aria-pressed", state.focus ? "true" : "false");
    if (state.focus) refocus(); else state.folded = new Set();
    renderBoard();
  });
  $("#unfoldAll").addEventListener("click", () => { state.focus = false; $("#focusLanes").setAttribute("aria-pressed", "false"); state.folded = new Set(); renderBoard(); });
  studsEl.addEventListener("click", e => { const b = e.target.closest(".stud"); if (!b) return; setPlaying(false); go(+b.dataset.i, true); });
  lanesEl.addEventListener("click", e => {
    const f = e.target.closest("[data-fold]");
    if (f) { const fk = focusKey(); const id = f.dataset.fold; state.focus = false; $("#focusLanes").setAttribute("aria-pressed", "false"); state.folded.has(id) ? state.folded.delete(id) : state.folded.add(id); renderBoard(); restoreFocus(fk); return; }
    const p = e.target.closest("[data-lane]");
    if (p) { state.view = "lane"; state.laneId = p.dataset.lane; renderPlate(); restoreFocus("[data-back]"); }
  });
  plate.addEventListener("click", e => {
    const n = e.target.closest("[data-nav]"); if (n) { setPlaying(false); go(state.idx + +n.dataset.nav, +n.dataset.nav > 0); return; }
    const c = e.target.closest("[data-copy]");
    if (c) {
      const txt = copyBodies[+c.dataset.copy];
      const ok = msg => { c.textContent = msg; c.classList.add("ok"); setTimeout(() => { c.textContent = "Copy"; c.classList.remove("ok"); }, 1600); };
      (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(() => ok("Copied")).catch(() => {
        getSelection().selectAllChildren(c.closest(".codebox").querySelector("pre"));
        let done = false; try { done = document.execCommand("copy"); } catch (_) { /* clipboard blocked */ }
        ok(done ? "Copied" : "Selected, press Ctrl+C");
      });
      return;
    }
    const l = e.target.closest("[data-lane]"); if (l) { state.view = "lane"; state.laneId = l.dataset.lane; renderPlate(); restoreFocus("[data-back]"); return; }
    if (e.target.closest("[data-back]")) { state.view = "step"; renderPlate(); restoreFocus(".p-title"); return; }
    const g = e.target.closest("[data-goto]"); if (g) { e.preventDefault(); setPlaying(false); go(+g.dataset.goto, true); }
  });
  document.addEventListener("keydown", e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target.tagName || "").toLowerCase();
    const interactive = tag === "button" || tag === "summary" || tag === "input" || tag === "a";
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === " " && !interactive) { e.preventDefault(); setPlaying(!state.playing); }
    else if (key === "ArrowRight") { e.preventDefault(); setPlaying(false); go(state.idx + 1, true); }
    else if (key === "ArrowLeft") { e.preventDefault(); setPlaying(false); go(state.idx - 1, false); }
    else if (key === "Home") { e.preventDefault(); setPlaying(false); go(0, false); }
    else if (key === "t") setLevel(state.level === "plain" ? "tech" : "plain");
    else { const sq = SEQ_KEYS.find(k => String(F.seqs[k].code).toLowerCase() === key); if (sq) setSeq(sq); }
  });
  let rz = 0;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(renderBoard, 120); });

  /* ---------- boot ---------- */
  function boot() {
    const h = decodeURIComponent((location.hash || "").slice(1));
    let sq = SEQ_KEYS[0], i = 0;
    if (h) {
      const isAlt = SEQ_KEYS.some(k => F.seqs[k].steps.some(s => s.id === h && s.alt));
      if (isAlt) { state.whatif = true; $("#whatif").checked = true; }
      for (const k of SEQ_KEYS) { if (F.seqs[k].steps.some(s => s.id === h)) { sq = k; break; } }
      state.seq = sq;
      i = Math.max(0, steps().findIndex(s => s.id === h));
    }
    $$(".route-plate").forEach(b => b.setAttribute("aria-pressed", b.dataset.seq === sq ? "true" : "false"));
    state.seq = sq; state.idx = i; state.t = 1;
    renderBoard(); renderPlate(); announce(); follow();
  }
  boot();
  window.addEventListener("hashchange", () => { setPlaying(false); boot(); });
})();
