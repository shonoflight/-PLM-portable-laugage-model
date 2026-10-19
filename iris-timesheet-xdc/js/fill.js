/* =====================================================================
 * fill.js — the timesheet screen you fill out
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   renderFill()   builds the whole screen into #fillView:
 *     • WORKER & PARTICIPANT card (number, names, usual service code)
 *     • PAY PERIOD card: pick P1…P27; shows start, end, due and pay
 *       dates automatically from js/schedule.js
 *     • jump bar: Week 1 · Week 2 · Totals · Sign
 *     • one card per day (14). "+ Shift" adds a start/stop pair, pre-
 *       filled from your last shift. Hours, AM/PM, day and week totals
 *       are worked out as you type. Times snap to 15-minute steps.
 *     • TOTALS card: hours per service code per week (exactly what goes
 *       in the form's weekly box), lines used of 32, and any problems.
 *     • SIGN card: draw signatures, dates default to today.
 *   refreshCalc()  updates only the numbers (keeps the keyboard open).
 *
 * TO CHANGE: card order = the list in renderFill(); quick time chips =
 *   QUICK_STARTS.
 *
 * DEPENDENCIES   js/schedule.js, js/model.js, js/store.js, js/signature.js
 * RELATIONSHIP   js/app.js calls renderFill() on start and after sync.
 * ===================================================================== */

const QUICK_STARTS = ["07:00", "08:00", "09:00", "12:00", "16:00", "20:00"];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/* tiny element helper: el("div", "cls", "text") */
function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}
function card(id, title, collapsed) {
  const s = el("section", "card" + (collapsed ? " collapsed" : ""));
  s.id = id;
  const h = el("h2", "", title);
  h.onclick = () => s.classList.toggle("collapsed");
  const f = el("div", "flow");
  s.append(h, f);
  return [s, f];
}
function field(cap, input) {
  const l = el("label", "line");
  l.append(el("span", "cap", cap), input);
  return l;
}
function input(type, value, onInput, attrs) {
  const i = el("input");
  i.type = type; i.value = value || "";
  Object.assign(i, attrs || {});
  i.addEventListener("input", () => onInput(i.value, i));
  return i;
}
function codeSelect(value, onChange) {
  const s = el("select");
  state.codes.forEach(c => { const o = el("option", "", c.code + " — " + c.name); o.value = c.code; s.appendChild(o); });
  s.value = value;
  s.onchange = () => onChange(s.value);
  return s;
}
const lastShift = () => {
  const d = periodData(), dates = Object.keys(d.days).sort().reverse();
  for (const k of dates) { const sh = d.days[k].filter(x => x.s && x.e).slice(-1)[0]; if (sh) return sh; }
  return null;
};

/* ------------------------------------------------------------------ */
function renderFill() {
  const root = document.getElementById("fillView");
  const keepY = window.scrollY;
  root.innerHTML = "";
  const p = periodById(state.cur), data = periodData(), pr = state.profile;

  /* jump bar */
  const jump = el("div", "jump");
  [["Week 1", "w1"], ["Week 2", "w2"], ["Totals", "totals"], ["Sign", "sign"], ["People", "people"]].forEach(([t, id]) => {
    const b = el("button", "", t); b.type = "button";
    b.onclick = () => document.getElementById(id).scrollIntoView({ behavior: "smooth" });
    jump.appendChild(b);
  });
  root.appendChild(jump);

  /* pay period */
  const [pc, pf] = card("period", "PAY PERIOD");
  const sel = el("select");
  allPeriods().forEach(x => { const o = el("option", "", x.label); o.value = x.id; sel.appendChild(o); });
  sel.value = state.cur;
  sel.onchange = () => { state.cur = sel.value; save(); renderFill(); window.scrollTo(0, 0); };
  const nav = el("div", "with-act");
  const prev = el("button", "act", "‹ Prev"), next = el("button", "act", "Next ›");
  const idx = allPeriods().findIndex(x => x.id === state.cur);
  prev.disabled = idx <= 0; next.disabled = idx >= allPeriods().length - 1;
  prev.onclick = () => { sel.value = allPeriods()[idx - 1].id; sel.onchange(); };
  next.onclick = () => { sel.value = allPeriods()[idx + 1].id; sel.onchange(); };
  nav.append(prev, sel, next);
  pf.appendChild(field("Pay period", nav));
  const facts = el("div", "facts");
  [["Starts", "Sun " + shortDate(p.start, true) + " 12:00 AM"], ["Ends (on form)", "Sat " + shortDate(p.end, true) + " 11:59 PM"],
   ["Submit by", shortDate(p.due, true)], ["Pay date", shortDate(p.pay, true)]].forEach(([k, v]) => {
    const d = el("div", "fact"); d.append(el("span", "cap", k), el("b", "", v)); facts.appendChild(d);
  });
  pf.appendChild(facts);
  const t = todayIso();
  if (t > p.due) pf.appendChild(el("p", "note warn", "The due date has passed. Late timesheets are processed the next pay period."));
  root.appendChild(pc);

  /* days, split into the form's two weeks */
  periodDays(p).forEach((iso, i) => {
    if (i === 0 || i === 7) {
      const wk = el("h3", "weekhead", "WEEK " + (i ? 2 : 1));
      wk.id = i ? "w2" : "w1";
      wk.appendChild(el("span", "wtot", ""));
      root.appendChild(wk);
    }
    root.appendChild(dayCard(iso, i));
  });

  /* totals */
  const [tc, tf] = card("totals", "TOTALS (FOR THE FORM'S WEEKLY BOX)");
  tf.appendChild(el("div", "sumtable"));
  tf.appendChild(el("p", "cap lines"));
  tf.appendChild(el("ul", "problems"));
  root.appendChild(tc);

  /* signatures */
  const [sc, sf] = card("sign", "SIGNATURES");
  sf.appendChild(el("p", "note", "Both signatures and dates are required. You can sign here, or print and sign on paper."));
  [["sigW", "sigWImg", "Participant-Hired Worker"], ["sigP", "sigPImg", "Participant"]].forEach(([dk, ik, who]) => {
    const row = el("div", "sigrow");
    const pic = el("div", "sigpic");
    if (data[ik]) { const im = el("img"); im.src = data[ik]; im.alt = who + " signature"; pic.appendChild(im); }
    else pic.appendChild(el("span", "cap", "Not signed"));
    const signBtn = el("button", "act", data[ik] ? "Sign again" : "Sign");
    signBtn.type = "button";
    signBtn.onclick = async () => {
      const png = await askSignature(who + " signature");
      if (!png) return;
      data[ik] = png;
      if (!data[dk]) data[dk] = todayIso();
      save(state.cur); renderFill();
    };
    const clearBtn = el("button", "act", "Remove"); clearBtn.type = "button";
    clearBtn.onclick = () => { data[ik] = ""; save(state.cur); renderFill(); };
    const date = input("date", data[dk], v => { data[dk] = v; save(state.cur); refreshCalc(); });
    const todayBtn = el("button", "act", "Today"); todayBtn.type = "button";
    todayBtn.onclick = () => { data[dk] = todayIso(); save(state.cur); renderFill(); };
    const acts = el("div", "with-act"); acts.append(signBtn); if (data[ik]) acts.append(clearBtn);
    const dateRow = el("div", "with-act"); dateRow.append(date, todayBtn);
    row.append(el("span", "subhead b", who), pic, acts, field("Date signed", dateRow));
    sf.appendChild(row);
  });
  root.appendChild(sc);

  /* people (rarely changes -> at the bottom, collapsed once filled) */
  const [wc, wf] = card("people", "WORKER & PARTICIPANT", !!(pr.workerNo && pr.workerName && pr.participant));
  const prof = (k, cap, type, attrs) => wf.appendChild(field(cap, input(type, pr[k], v => { pr[k] = v; save("profile"); refreshCalc(); }, attrs)));
  prof("workerNo", "Participant-Hired Worker Number *", "text", { inputMode: "numeric", autocomplete: "off" });
  prof("workerName", "Participant-Hired Worker Name", "text", { autocomplete: "name" });
  prof("participant", "Participant Name", "text");
  wf.appendChild(field("Usual service code (new shifts start with it)", codeSelect(pr.defCode, v => { pr.defCode = v; save("profile"); })));
  const addCode = el("button", "act", "+ Add another service code"); addCode.type = "button";
  addCode.onclick = () => {
    const code = (prompt("Service code abbreviation (from your IRIS Consultant):") || "").trim().toUpperCase();
    if (!code || state.codes.some(c => c.code === code)) return;
    const name = (prompt("What is " + code + " called?") || code).trim();
    state.codes.push({ code, name }); save("profile"); renderFill();
  };
  wf.appendChild(addCode);
  root.appendChild(wc);

  refreshCalc();
  window.scrollTo(0, keepY);
}

/* One day: header with total, its shifts, "+ Shift" */
function dayCard(iso, i) {
  const data = periodData();
  const s = el("section", "card day" + (iso === todayIso() ? " today" : ""));
  s.dataset.date = iso;
  const h = el("div", "dayhead");
  h.append(el("b", "", DOW[i % 7] + " " + shortDate(iso)), el("span", "daytot", ""));
  s.appendChild(h);
  const shifts = data.days[iso] || [];
  shifts.forEach((sh, n) => s.appendChild(shiftRow(iso, sh, n)));
  const add = el("button", "addshift", "+ Shift"); add.type = "button";
  add.onclick = () => {
    const last = (data.days[iso] || []).length ? null : lastShift();   // 2nd shift of a day starts blank
    (data.days[iso] = data.days[iso] || []).push(last ? { s: last.s, e: last.e, c: last.c } : { s: "", e: "", c: state.profile.defCode });
    save(state.cur); renderFill();
  };
  s.appendChild(add);
  return s;
}

function shiftRow(iso, sh, n) {
  const data = periodData();
  const row = el("div", "shift");
  const onTime = k => (v, inp) => { sh[k] = v; save(state.cur); refreshCalc(); };
  const snap = (k, inp) => () => {
    const v = snap15(inp.value);
    if (v !== inp.value) { inp.value = v; sh[k] = v; save(state.cur); refreshCalc(); flash(inp); }
  };
  const st = input("time", sh.s, onTime("s"), { step: 900 });
  const en = input("time", sh.e, onTime("e"), { step: 900 });
  st.addEventListener("change", snap("s", st)); en.addEventListener("change", snap("e", en));
  st.addEventListener("blur", snap("s", st)); en.addEventListener("blur", snap("e", en));
  const chips = el("div", "chips");
  if (!sh.s) QUICK_STARTS.forEach(q => {
    const b = el("button", "", label12(q)); b.type = "button";
    b.onclick = () => { sh.s = q; save(state.cur); renderFill(); };
    chips.appendChild(b);
  });
  const code = codeSelect(sh.c || state.profile.defCode, v => { sh.c = v; save(state.cur); refreshCalc(); });
  const del = el("button", "del", "✕"); del.type = "button"; del.title = "Remove this shift";
  del.onclick = () => {
    data.days[iso].splice(n, 1);
    if (!data.days[iso].length) delete data.days[iso];
    save(state.cur); renderFill();
  };
  const hrs = el("div", "hrs"); hrs.dataset.date = iso; hrs.dataset.n = n;
  const times = el("div", "row");
  times.append(field("Start", st), field("End", en), field("Code", code));
  row.append(times, chips, hrs, del);
  return row;
}
function flash(inp) { inp.classList.add("snapped"); setTimeout(() => inp.classList.remove("snapped"), 900); }

/* ------------------------------------------------------------------ */
function refreshCalc() {
  const data = periodData(), sum = summary();
  document.querySelectorAll(".hrs").forEach(h => {
    const sh = (data.days[h.dataset.date] || [])[+h.dataset.n];
    if (!sh) return;
    if (!sh.s || !sh.e) { h.textContent = "Enter start and end"; h.className = "hrs muted"; return; }
    const over = toMin(sh.e) <= toMin(sh.s);
    h.className = "hrs";
    h.textContent = label12(sh.s) + " – " + label12(sh.e) + " = " + fmtHours(shiftHours(sh)) + " h" + (over ? "  (past midnight: split into 2 lines on the form)" : "");
  });
  document.querySelectorAll(".card.day").forEach(c => {
    // total of the shifts entered on this day (an overnight shift counts fully on the day it started)
    const v = (data.days[c.dataset.date] || []).reduce((t, sh) => t + shiftHours(sh), 0);
    c.querySelector(".daytot").textContent = v ? fmtHours(v) + " h" : "";
  });
  const w = document.querySelectorAll(".weekhead .wtot");
  if (w[0]) w[0].textContent = fmtHours(sum.w1) + " h";
  if (w[1]) w[1].textContent = fmtHours(sum.w2) + " h";

  const box = document.querySelector(".sumtable");
  if (box) {
    const rows = sum.rows.map((r, i) => "<tr" + (i >= FORM_CODES ? ' class="over"' : "") + "><td>" + r.code + "</td><td>" + fmtHours(r.w1) + "</td><td>" + fmtHours(r.w2) + "</td><td>" + fmtHours(r.w1 + r.w2) + "</td></tr>").join("");
    box.innerHTML = "<table><tr><th>Service Code</th><th>Week 1</th><th>Week 2</th><th>Both</th></tr>" + rows +
      "<tr class='tot'><td>TOTAL HOURS</td><td>" + fmtHours(sum.w1) + "</td><td>" + fmtHours(sum.w2) + "</td><td>" + fmtHours(sum.total) + "</td></tr></table>";
    const n = formLines().length;
    document.querySelector(".lines").textContent = "Form lines used: " + n + " of " + FORM_LINES;
    const ul = document.querySelector(".problems");
    ul.innerHTML = "";
    const pr = problems();
    if (!pr.length) ul.appendChild(el("li", "ok", "Ready to make the PDF."));
    pr.forEach(x => ul.appendChild(el("li", x.level, x.text)));
  }
  if (typeof updateBar === "function") updateBar();
}
