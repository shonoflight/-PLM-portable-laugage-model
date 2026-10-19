/* =====================================================================
 * fill.js — the timesheet screen you fill out   (v1.1)
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   renderFill()   builds the whole screen into #fillView:
 *     • PAY PERIOD card: pick P1…P27; start, end, due and pay dates fill
 *       in from js/schedule.js
 *     • jump bar: Week 1 · Week 2 · Totals · Sign · Defaults
 *     • one card per day (14). "+ Shift" adds a shift, suggested from
 *       your Defaults (last shift / default times / blank). A 2nd shift
 *       on the same day starts where the 1st one ended.
 *       Each time = typed text (8, 830, 8:30, 16:30) + AM / PM buttons,
 *       like the paper form. A missing AM/PM is flagged in red on the
 *       row, in a notice at the bottom, and blocks Make PDF.
 *       Times snap to 15-minute steps.
 *     • TOTALS card: hours per service code per week, lines used of 32,
 *       and every problem found (js/model.js problems()).
 *     • SIGN card: draw signatures; date fills in as today (optional).
 *     • DEFAULTS card: worker number, names, usual service code, how new
 *       shifts are suggested, default shift times, quick-pick times,
 *       auto signature date, service code list, save/load defaults file.
 *   refreshCalc()  updates only numbers and warnings (keeps the keyboard).
 *
 * TO CHANGE: card order = the order in renderFill(); time control look =
 *   timeControl(); suggestion rules = suggestShift().
 *
 * DEPENDENCIES   js/ui.js, js/schedule.js, js/model.js, js/store.js,
 *                js/signature.js
 * RELATIONSHIP   js/app.js calls renderFill() on start and after sync.
 * ===================================================================== */

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
let _shiftRefreshers = [];   // one per shift row on screen, called by refreshCalc()

/* ---------- small builders ---------- */
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
function button(text, cls, onClick) {
  const b = el("button", cls, text); b.type = "button"; b.onclick = onClick; return b;
}
function codeSelect(value, onChange) {
  const s = el("select");
  const list = state.codes.slice();
  if (value && !list.some(c => c.code === value)) list.push({ code: value, name: "(not in your list)" });
  list.forEach(c => { const o = el("option", "", c.code + " — " + c.name); o.value = c.code; s.appendChild(o); });
  s.value = value;
  s.onchange = () => onChange(s.value);
  return s;
}

/* Time control: [ 8:30 ] [AM] [PM].  obj[k+"In"] / obj[k+"Ap"] hold the
   typed text and the choice; onDone(phase) runs on each change
   (phase "typing" while typing, "commit" when the box is left or AM/PM tapped). */
function timeControl(obj, k, onDone, label) {
  const wrap = el("div", "tc");
  const txt = input("text", obj[k + "In"], v => { obj[k + "In"] = v; onDone("typing"); },
    { inputMode: "numeric", placeholder: "8:30", autocomplete: "off", maxLength: 8 });
  txt.setAttribute("aria-label", label + " time");
  txt.addEventListener("change", () => onDone("commit"));
  const ap = el("div", "ap");
  ["AM", "PM"].forEach(v => {
    const b = button(v, obj[k + "Ap"] === v ? "on" : "", () => { obj[k + "Ap"] = v; onDone("commit"); });
    b.setAttribute("aria-label", label + " " + v);
    ap.appendChild(b);
  });
  wrap.append(txt, ap);
  wrap.sync = () => {   // show what the model holds now
    if (document.activeElement !== txt) txt.value = obj[k + "In"] || "";
    ap.querySelectorAll("button").forEach(x => x.classList.toggle("on", x.textContent === obj[k + "Ap"]));
    const r = parseTime(obj[k + "In"], obj[k + "Ap"]);
    wrap.classList.toggle("need", r.needAp);
    wrap.classList.toggle("bad", r.bad);
  };
  wrap.sync();
  return wrap;
}

/* Notice when a time has no AM/PM. Waits a moment: leaving the box and
   then tapping AM/PM right away shouldn't show it. */
function warnIfNoAp(obj, k, text) {
  setTimeout(() => { if (parseTime(obj[k + "In"], obj[k + "Ap"]).needAp) showToast(text, "warn", 5000); }, 500);
}

/* ---------- suggestions for a new shift ---------- */
function lastShift() {
  const look = id => {
    const d = state.periods[id];
    if (!d) return null;
    for (const k of Object.keys(d.days).sort().reverse()) {
      const sh = d.days[k].filter(x => x.s && x.e).slice(-1)[0];
      if (sh) return sh;
    }
    return null;
  };
  const prev = prevPeriod();
  return look(state.cur) || (prev && look(prev.id));
}
function suggestShift(iso) {
  const pr = state.profile, today = periodData().days[iso] || [];
  if (today.length) {   // 2nd shift of the day starts where the last one ended
    const end = today.map(x => x.e).filter(Boolean).slice(-1)[0];
    return makeShift(end || "", "", today[today.length - 1].c);
  }
  if (pr.suggest === "last") { const l = lastShift(); if (l) return makeShift(l.s, l.e, l.c); }
  if (pr.suggest !== "blank" && (pr.defStart || pr.defEnd)) return makeShift(pr.defStart, pr.defEnd, pr.defCode);
  return makeShift("", "", pr.defCode);
}

/* ------------------------------------------------------------------ */
function renderFill() {
  const root = document.getElementById("fillView");
  const keepY = window.scrollY;
  root.innerHTML = "";
  _shiftRefreshers = [];
  const p = periodById(state.cur), data = periodData(), pr = state.profile;

  /* jump bar */
  const jump = el("div", "jump");
  [["Week 1", "w1"], ["Week 2", "w2"], ["Totals", "totals"], ["Sign", "sign"], ["Defaults", "defaults"]].forEach(([t, id]) => {
    jump.appendChild(button(t, "", () => {
      const target = document.getElementById(id);
      target.classList.remove("collapsed");
      target.scrollIntoView({ behavior: "smooth" });
    }));
  });
  root.appendChild(jump);

  /* first run: point at Defaults */
  if (!pr.workerNo) {
    const hint = el("p", "note warn", "First time? Fill in the Defaults card (worker number, names, usual times) — every timesheet uses it. ");
    hint.appendChild(button("Go to Defaults", "act", () => document.getElementById("defaults").scrollIntoView({ behavior: "smooth" })));
    root.appendChild(hint);
  }

  /* pay period */
  const [pc, pf] = card("period", "PAY PERIOD");
  const ps = allPeriods(), idx = ps.findIndex(x => x.id === state.cur);
  const goPeriod = id => { state.cur = id; renderFill(); window.scrollTo(0, 0); };
  const sel = el("select");
  ps.forEach(x => { const o = el("option", "", x.label); o.value = x.id; sel.appendChild(o); });
  sel.value = state.cur;
  sel.onchange = () => goPeriod(sel.value);
  const prevB = button("‹ Prev", "act", () => goPeriod(ps[idx - 1].id));
  const nextB = button("Next ›", "act", () => goPeriod(ps[idx + 1].id));
  prevB.disabled = idx <= 0; nextB.disabled = idx >= ps.length - 1;
  const nav = el("div", "with-act"); nav.append(prevB, sel, nextB);
  pf.appendChild(field("Pay period", nav));
  const facts = el("div", "facts");
  [["Starts", "Sun " + shortDate(p.start, true) + " 12:00 AM"], ["Ends (on form)", "Sat " + shortDate(p.end, true) + " 11:59 PM"],
   ["Submit by", shortDate(p.due, true)], ["Pay date", shortDate(p.pay, true)]].forEach(([k, v]) => {
    const d = el("div", "fact"); d.append(el("span", "cap", k), el("b", "", v)); facts.appendChild(d);
  });
  pf.appendChild(facts);
  if (todayIso() > p.due) pf.appendChild(el("p", "note warn", "The due date has passed. Late timesheets are processed the next pay period."));
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
  tf.append(el("div", "sumtable"), el("p", "cap lines"), el("ul", "problems"));
  root.appendChild(tc);

  root.appendChild(signCard(data));
  root.appendChild(defaultsCard(pr));

  refreshCalc();
  window.scrollTo(0, keepY);
}

/* One day: header with total, carried line, its shifts, "+ Shift" */
function dayCard(iso, i) {
  const data = periodData();
  const s = el("section", "card day" + (iso === todayIso() ? " today" : ""));
  s.dataset.date = iso;
  const h = el("div", "dayhead");
  h.append(el("b", "", DOW[i % 7] + " " + shortDate(iso)), el("span", "daytot", ""));
  s.appendChild(h);
  carriedLines().filter(l => l.date === iso).forEach(l => {
    s.appendChild(el("p", "carried", "12:00 AM – " + label12(l.e) + " = " + fmtHours(l.hours) + " h · " + l.c +
      " (carried from the overnight shift of " + shortDate(l.from) + ")"));
  });
  (data.days[iso] || []).forEach((sh, n) => s.appendChild(shiftRow(iso, sh, n)));
  s.appendChild(button("+ Shift", "addshift", () => {
    (data.days[iso] = data.days[iso] || []).push(suggestShift(iso));
    save(state.cur); renderFill();
  }));
  return s;
}

function shiftRow(iso, sh, n) {
  const data = periodData();
  const row = el("div", "shift");
  let st, en;
  const changed = (k, phase) => {
    const note = setShiftTime(sh, k, phase === "typing");
    save(state.cur);
    if (phase !== "typing") {
      const name = k === "s" ? "start" : "end";
      if (parseTime(sh[k + "In"], sh[k + "Ap"]).bad) showToast("That " + name + " time isn't a time. Try 8:30.", "warn");
      else if (note === "snapped") showToast("Rounded to the nearest 15 minutes: " + label12(sh[k]));
      warnIfNoAp(sh, k, "Choose AM or PM for the " + name + " time (" + DOW[isoToDate(iso).getDay()] + " " + shortDate(iso) + ").");
    }
    refreshCalc();
  };
  st = timeControl(sh, "s", ph => changed("s", ph), "Start");
  en = timeControl(sh, "e", ph => changed("e", ph), "End");

  const chips = el("div", "chips");
  if (!sh.sIn) (state.profile.quick || []).forEach(q => chips.appendChild(button(label12(q), "", () => {
    Object.assign(sh, { sIn: to12(q).t.replace(/^0/, ""), sAp: to12(q).ap, s: q });
    save(state.cur); renderFill();
  })));
  const code = codeSelect(sh.c || state.profile.defCode, v => { sh.c = v; save(state.cur); refreshCalc(); });
  const del = button("✕", "del", async () => {
    if ((sh.sIn || sh.eIn) && !(await askConfirm("Remove this shift?", "Remove", "Keep"))) return;
    data.days[iso].splice(n, 1);
    if (!data.days[iso].length) delete data.days[iso];
    save(state.cur); renderFill();
  });
  del.title = "Remove this shift"; del.setAttribute("aria-label", "Remove this shift");
  const hrs = el("div", "hrs"), msgs = el("ul", "msgs");
  const times = el("div", "row");
  times.append(field("Start", st), field("End", en), field("Code", code));
  row.append(times, chips, hrs, msgs, del);

  _shiftRefreshers.push(() => {
    st.sync(); en.sync();
    const ps = shiftProblems(sh);
    msgs.replaceChildren(...ps.map(x => el("li", x.level, "⚠ " + x.text)));
    if (sh.s && sh.e && sh.s !== sh.e) {
      hrs.className = "hrs";
      hrs.textContent = label12(sh.s) + " – " + label12(sh.e) + " = " + fmtHours(shiftHours(sh)) + " h" +
        (crossesMidnight(sh) ? "  (past midnight: split into 2 lines on the form)" : "");
    } else { hrs.className = "hrs muted"; hrs.textContent = ps.length ? "" : "Enter start and end"; }
  });
  return row;
}

/* ---------- signatures ---------- */
function signCard(data) {
  const [sc, sf] = card("sign", "SIGNATURES");
  sf.appendChild(el("p", "note", "Both signatures and dates are required. Sign here, or print and sign on paper."));
  [["sigW", "sigWImg", "Participant-Hired Worker"], ["sigP", "sigPImg", "Participant"]].forEach(([dk, ik, who]) => {
    const row = el("div", "sigrow");
    const pic = el("div", "sigpic");
    if (data[ik]) { const im = el("img"); im.src = data[ik]; im.alt = who + " signature"; pic.appendChild(im); }
    else pic.appendChild(el("span", "cap", "Not signed"));
    const acts = el("div", "with-act");
    acts.appendChild(button(data[ik] ? "Sign again" : "Sign", "act", async () => {
      const png = await askSignature(who + " signature");
      if (!png) return;
      data[ik] = png;
      if (state.profile.autoSigDate || !data[dk]) data[dk] = todayIso();
      save(state.cur); renderFill();
    }));
    if (data[ik]) acts.appendChild(button("Remove", "act", () => { data[ik] = ""; save(state.cur); renderFill(); }));
    const date = input("date", data[dk], v => { data[dk] = v; save(state.cur); refreshCalc(); });
    const dateRow = el("div", "with-act");
    dateRow.append(date, button("Today", "act", () => { data[dk] = todayIso(); save(state.cur); renderFill(); }));
    row.append(el("span", "subhead b", who), pic, acts, field("Date signed", dateRow));
    sf.appendChild(row);
  });
  return sc;
}

/* ---------- defaults ---------- */
function defaultsCard(pr) {
  const [wc, wf] = card("defaults", "DEFAULTS", !!(pr.workerNo && pr.workerName && pr.participant));
  const saveP = () => { save("profile"); refreshCalc(); };
  const text = (k, cap, attrs) => wf.appendChild(field(cap, input("text", pr[k], v => { pr[k] = v.trim(); saveP(); }, attrs)));

  wf.appendChild(el("span", "subhead b", "People"));
  text("workerNo", "Participant-Hired Worker Number *", { inputMode: "numeric", autocomplete: "off" });
  text("workerName", "Participant-Hired Worker Name", { autocomplete: "name" });
  text("participant", "Participant Name");

  wf.appendChild(el("span", "subhead b", "New shifts"));
  wf.appendChild(field("Usual service code", codeSelect(pr.defCode, v => { pr.defCode = v; saveP(); })));
  const sug = el("select");
  [["last", "Copy my last shift (else default times)"], ["default", "Use my default times below"], ["blank", "Start blank"]]
    .forEach(([v, t]) => { const o = el("option", "", t); o.value = v; sug.appendChild(o); });
  sug.value = pr.suggest;
  sug.onchange = () => { pr.suggest = sug.value; saveP(); };
  wf.appendChild(field("When I tap + Shift", sug));

  // default times use the same time control (kept in a scratch shift)
  const dt = makeShift(pr.defStart, pr.defEnd);
  const dHrs = el("p", "cap");
  const showD = () => {
    dHrs.textContent = pr.defStart && pr.defEnd && pr.defStart !== pr.defEnd ? "Default shift: " + fmtHours(shiftHours({ s: pr.defStart, e: pr.defEnd })) + " h" : "";
  };
  let ds, de;
  const dChanged = (k, phase) => {
    if (phase === "typing") return;
    setShiftTime(dt, k);
    (k === "s" ? ds : de).sync();
    warnIfNoAp(dt, k, "Choose AM or PM for the default " + (k === "s" ? "start" : "end") + " time.");
    pr.defStart = dt.s; pr.defEnd = dt.e; saveP(); showD();
  };
  ds = timeControl(dt, "s", ph => dChanged("s", ph), "Default start");
  de = timeControl(dt, "e", ph => dChanged("e", ph), "Default end");
  const dRow = el("div", "row");
  dRow.append(field("Default start", ds), field("Default end", de));
  wf.append(dRow, dHrs); showD();

  const quick = input("text", (pr.quick || []).map(label12).join(", "), () => {}, { placeholder: "7 AM, 8:30 AM, 4 PM" });
  const qNote = el("p", "cap");
  quick.addEventListener("change", () => {
    const ok = [], badOnes = [];
    quick.value.split(",").map(x => x.trim()).filter(Boolean).forEach(tok => {
      const r = parseTime(tok, "");
      if (r.hhmm) ok.push(snap15(r.hhmm)); else badOnes.push(tok);
    });
    pr.quick = Array.from(new Set(ok)).sort(); save("profile");
    renderFill();
    if (badOnes.length) showToast("Skipped " + badOnes.join(", ") + ": quick-pick times need AM or PM, e.g. 7 AM.", "warn", 6000);
  });
  wf.appendChild(field("Quick-pick start times (comma separated)", quick));

  const auto = el("label", "pill");
  const cb = el("input"); cb.type = "checkbox"; cb.checked = !!pr.autoSigDate;
  cb.onchange = () => { pr.autoSigDate = cb.checked; saveP(); };
  auto.append(cb, document.createTextNode("Signing fills in today's date"));
  wf.appendChild(auto);

  wf.appendChild(el("span", "subhead b", "Service codes"));
  const list = el("div", "codes");
  state.codes.forEach((c, i) => {
    const r = el("div", "coderow");
    r.append(el("b", "", c.code), el("span", "", c.name));
    if (!DEFAULT_CODES.some(d => d.code === c.code)) r.appendChild(button("✕", "del inline", () => { state.codes.splice(i, 1); saveP(); renderFill(); }));
    list.appendChild(r);
  });
  wf.appendChild(list);
  const nc = input("text", "", () => {}, { placeholder: "Code", maxLength: 8 });
  const nn = input("text", "", () => {}, { placeholder: "What it's called" });
  const addRow = el("div", "with-act");
  addRow.append(nc, nn, button("Add", "act", () => {
    const code = nc.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    if (!code) return showToast("Type the code first.", "warn");
    if (state.codes.some(c => c.code === code)) return showToast(code + " is already in the list.", "warn");
    state.codes.push({ code, name: nn.value.trim() || code }); saveP(); renderFill();
  }));
  wf.appendChild(field("Add a code from your IRIS Consultant", addRow));

  if (hasXdc()) {
    wf.appendChild(el("span", "subhead b", "Use these defaults in another copy of the app"));
    const fileRow = el("div", "with-act");
    fileRow.append(
      button("Save defaults to chat", "act", async () => {
        try { await exportDefaults(); showToast("Defaults file is in the draft. Send it to keep it."); }
        catch (e) { showToast("Could not save: " + e.message, "warn"); }
      }),
      button("Load defaults file", "act", async () => {
        try { if (await importDefaults()) { renderFill(); showToast("Defaults loaded."); } }
        catch (e) { showToast("Could not load: " + e.message, "warn"); }
      }));
    wf.appendChild(fileRow);
  }
  return wc;
}

/* ------------------------------------------------------------------ */
function refreshCalc() {
  const data = periodData(), sum = summary(), carried = carriedLines();
  _shiftRefreshers.forEach(f => f());
  document.querySelectorAll(".card.day").forEach(c => {
    // shifts entered on this day (an overnight shift counts on the day it started) + carried part
    const d = c.dataset.date;
    const v = (data.days[d] || []).reduce((t, sh) => t + shiftHours(sh), 0) +
      carried.filter(l => l.date === d).reduce((t, l) => t + l.hours, 0);
    c.querySelector(".daytot").textContent = v ? fmtHours(v) + " h" : "";
  });
  const w = document.querySelectorAll(".weekhead .wtot");
  if (w[0]) w[0].textContent = fmtHours(sum.w1) + " h";
  if (w[1]) w[1].textContent = fmtHours(sum.w2) + " h";

  const box = document.querySelector(".sumtable");
  if (box) {
    // built with DOM nodes (not innerHTML): codes can come from other chat members
    const t = el("table"), head = el("tr");
    ["Service Code", "Week 1", "Week 2", "Both"].forEach(x => head.appendChild(el("th", "", x)));
    t.appendChild(head);
    const addRow = (cells, cls) => { const r = el("tr", cls); cells.forEach(x => r.appendChild(el("td", "", x))); t.appendChild(r); };
    sum.rows.forEach((r, i) => addRow([r.code, fmtHours(r.w1), fmtHours(r.w2), fmtHours(r.w1 + r.w2)], i >= FORM_CODES ? "over" : ""));
    addRow(["TOTAL HOURS", fmtHours(sum.w1), fmtHours(sum.w2), fmtHours(sum.total)], "tot");
    box.replaceChildren(t);
    document.querySelector(".lines").textContent = "Form lines used: " + formLines().length + " of " + FORM_LINES;
    const pr = problems();
    const items = pr.map(x => el("li", x.level, x.text));
    if (!pr.some(x => x.level === "error")) items.unshift(el("li", "ok", "Ready to make the PDF."));
    document.querySelector(".problems").replaceChildren(...items);
  }
  if (typeof updateBar === "function") updateBar();
}
