/* =====================================================================
 * model.js — timesheet data + all the automatic math   (v1.1)
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   1. The data shape (one global `state`, saved by js/store.js):
 *        state.profile  defaults (see DEFAULT_PROFILE): worker number,
 *                       names, usual service code, how new shifts are
 *                       suggested, default shift times, quick-pick times,
 *                       auto signature date
 *        state.codes    service code list [{code, name}]
 *        state.cur      id of the pay period on screen
 *        state.periods  { periodId: { days: {"YYYY-MM-DD": [shift…]},
 *                                     sigW, sigP, sigWImg, sigPImg, ts } }
 *        shift          { sIn:"8:00", sAp:"AM", eIn:"4:30", eAp:"PM", c:"PC",
 *                         s:"08:00", e:"16:30" }
 *                       sIn/sAp/eIn/eAp = what the person typed/tapped;
 *                       s/e = the 24-hour result ("" until complete).
 *   2. Time entry:
 *        parseTime(text, ap)  -> {hhmm, ap, needAp, bad}. Accepts 8, 830,
 *                       8:30, 0830. Hours 13-23 or 0 are read as 24-hour
 *                       time and pick AM/PM by themselves. 1-12 NEED AM/PM.
 *        setShiftTime(sh, "s"|"e")  re-computes sh.s / sh.e (snapped to
 *                       15 minutes) from what was typed.
 *        AM/PM RULE (v1.2): the app never picks AM/PM for you. Only you
 *        do: by tapping AM/PM, typing "pm", or typing a 24-hour time.
 *        Rounding never crosses noon/midnight (it rounds down instead).
 *   3. Math:  shiftHours (overnight-aware), to12 for the form.
 *   4. Form lines: formLines(periodId). A shift past midnight is split at
 *        12:00 AM. The after-midnight part of a shift on the LAST night of
 *        a period moves to the NEXT period's first line ("carried").
 *   5. Totals: summary(periodId);  6. Checks: problems(periodId).
 *
 * TO CHANGE: service codes = DEFAULT_CODES; first-run defaults =
 *   DEFAULT_PROFILE; form size = FORM_LINES / FORM_CODES.
 *
 * DEPENDENCIES   js/schedule.js
 * RELATIONSHIP   read by js/fill.js (screen), js/pdffill.js (PDF),
 *                saved by js/store.js.
 * ===================================================================== */

const FORM_LINES = 32;   // day rows on the official form (16 + 16)
const FORM_CODES = 4;    // service code rows in the weekly totals box
const DEFAULT_CODES = [
  { code: "SHC", name: "Supportive Home Care - Routine" },
  { code: "C",   name: "Supportive Home Care - Chores" },
  { code: "DLS", name: "Daily Living Skills" },
  { code: "PC",  name: "Personal Care" },
  { code: "CC",  name: "Supportive Home Care - Companion Care" },
  { code: "R",   name: "Respite" },
];
const DEFAULT_PROFILE = {
  workerNo: "", workerName: "", participant: "",
  defCode: "SHC",
  suggest: "last",            // new shift: "last" = copy last shift, "default" = default times, "blank"
  defStart: "", defEnd: "",   // default shift times, 24-hour "HH:MM" ("" = none)
  quick: ["07:00", "08:00", "09:00", "12:00", "16:00", "20:00"],   // quick-pick start times
  autoSigDate: true,          // signing fills today's date
};

function blankState() {
  return {
    profile: Object.assign({}, DEFAULT_PROFILE, { quick: DEFAULT_PROFILE.quick.slice() }),
    codes: DEFAULT_CODES.map(c => Object.assign({}, c)),
    cur: defaultPeriodId(),
    periods: {},
    syncOn: true,
  };
}
let state = blankState();

/* The record for one pay period (created empty on first use). */
function periodData(id) {
  id = id || state.cur;
  if (!state.periods[id]) state.periods[id] = { days: {}, sigW: "", sigP: "", ts: 0 };
  return state.periods[id];
}
/* Previous period (or null) — used to carry an overnight shift forward. */
function prevPeriod(id) {
  const ps = allPeriods(), i = ps.findIndex(p => p.id === (id || state.cur));
  return i > 0 ? ps[i - 1] : null;
}

/* ---- time math ---- */
const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
function snap15(t) { return t ? fromMin(Math.round(toMin(t) / 15) * 15) : t; }

/* Typed text + AM/PM choice -> { hhmm: "HH:MM" | "", ap, needAp, bad } */
function parseTime(text, ap) {
  const t = String(text || "").trim().toLowerCase().replace(/\s+/g, "");
  if (!t) return { hhmm: "", ap: ap || "", needAp: false, bad: false };
  let m = t.match(/^(\d{1,2})(?::?(\d{2}))?(a|am|p|pm)?$/);
  if (!m && /^\d{3,4}(a|am|p|pm)?$/.test(t)) {   // "830", "1215pm"
    const d = t.match(/^(\d{1,2})(\d{2})(a|am|p|pm)?$/); m = [t, d[1], d[2], d[3]];
  }
  if (!m) return { hhmm: "", ap: ap || "", needAp: false, bad: true };
  let h = +m[1]; const mi = m[2] ? +m[2] : 0;
  if (m[3]) ap = m[3][0] === "a" ? "AM" : "PM";   // "8:30pm" typed directly
  if (mi > 59 || h > 23) return { hhmm: "", ap: ap || "", needAp: false, bad: true };
  if (h === 0 || h > 12) {                          // 24-hour time: AM/PM is known
    return { hhmm: fromMin(h * 60 + mi), ap: h < 12 ? "AM" : "PM", needAp: false, bad: false, was24: true };
  }
  if (!ap) return { hhmm: "", ap: "", needAp: true, bad: false };
  const h24 = (h % 12) + (ap === "PM" ? 12 : 0);
  return { hhmm: fromMin(h24 * 60 + mi), ap, needAp: false, bad: false };
}
/* Re-compute sh.s or sh.e from sh.sIn/sAp (or eIn/eAp). Snaps to 15 min.
   quiet = true while typing: update the result but leave the text alone.
   Returns "snapped" | "24h" | "" so the screen can say what happened. */
function setShiftTime(sh, k, quiet) {
  const r = parseTime(sh[k + "In"], sh[k + "Ap"]);
  let note = "";
  if (r.hhmm) {
    let snapped = snap15(r.hhmm);
    if (to12(snapped).ap !== r.ap) snapped = fromMin(Math.floor(toMin(r.hhmm) / 15) * 15);   // keep your AM/PM
    if (snapped !== r.hhmm) note = "snapped";
    else if (r.was24) note = "24h";
    sh[k] = snapped;
    if (quiet) return "";
    const x = to12(snapped);
    sh[k + "In"] = x.t.replace(/^0/, "");
    sh[k + "Ap"] = x.ap;
  } else sh[k] = "";
  return note;
}
/* Shift from 24-hour times (used for suggestions, quick picks, old data). */
function makeShift(s, e, c) {
  const sh = { sIn: "", sAp: "", eIn: "", eAp: "", s: "", e: "", c: c || state.profile.defCode };
  if (s) { const x = to12(s); sh.sIn = x.t.replace(/^0/, ""); sh.sAp = x.ap; sh.s = s; }
  if (e) { const x = to12(e); sh.eIn = x.t.replace(/^0/, ""); sh.eAp = x.ap; sh.e = e; }
  return sh;
}
/* v1.0 data stored only s/e: fill in the typed fields. */
function migrateShift(sh) {
  if (sh.sIn === undefined) Object.assign(sh, makeShift(sh.s, sh.e, sh.c));
  return sh;
}

/* Minutes worked. End before start = runs past midnight. */
function shiftMinutes(sh) {
  if (!sh.s || !sh.e || sh.s === sh.e) return 0;
  let d = toMin(sh.e) - toMin(sh.s);
  if (d < 0) d += 1440;
  return d;
}
function shiftHours(sh) { return Math.round(shiftMinutes(sh) / 15) / 4; }
const crossesMidnight = sh => sh.s && sh.e && sh.s !== sh.e && toMin(sh.e) < toMin(sh.s);
function fmtHours(h) { return h.toFixed(2); }

/* "13:15" -> { t: "01:15", ap: "PM" }   (noon = 12 PM, midnight = 12 AM) */
function to12(t) {
  const [h, m] = t.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { t: String(h12).padStart(2, "0") + ":" + String(m).padStart(2, "0"), ap: h < 12 ? "AM" : "PM" };
}
function label12(t) { if (!t) return ""; const x = to12(t); return x.t.replace(/^0/, "") + " " + x.ap; }

/* ---- form lines ---- */
/* After-midnight part of the previous period's last-night shifts. */
function carriedLines(periodId) {
  const p = periodById(periodId || state.cur), prev = prevPeriod(periodId);
  if (!prev || !state.periods[prev.id]) return [];
  const lastDay = state.periods[prev.id].days[prev.end] || [];
  return lastDay.filter(crossesMidnight).filter(sh => sh.e !== "00:00").map(sh => ({
    date: p.start, s: "00:00", e: sh.e, hours: shiftHours({ s: "00:00", e: sh.e }),
    c: sh.c || state.profile.defCode, week: 1, carried: true, from: prev.end,
  }));
}
/* All lines for the form, sorted by date/time: {date, s, e, hours, c, week}.
   allLines() also keeps the part that spills into the NEXT period (spill). */
function formLines(periodId) { return allLines(periodId).filter(l => !l.spill); }
function allLines(periodId) {
  const p = periodById(periodId || state.cur), data = periodData(periodId);
  const weekOf = iso => (iso < addDays(p.start, 7) ? 1 : 2);
  const lines = carriedLines(periodId);
  Object.keys(data.days).sort().forEach(date => {
    data.days[date].filter(sh => sh.s && sh.e && sh.s !== sh.e)
      .forEach(sh => {
        const c = sh.c || state.profile.defCode;
        if (!crossesMidnight(sh)) {
          lines.push({ date, s: sh.s, e: sh.e, hours: shiftHours(sh), c, week: weekOf(date) });
        } else {   // past midnight -> split at 12:00 AM
          const next = addDays(date, 1);
          lines.push({ date, s: sh.s, e: "00:00", hours: shiftHours({ s: sh.s, e: "00:00" }), c, week: weekOf(date) });
          if (sh.e !== "00:00") lines.push({ date: next, s: "00:00", e: sh.e, hours: shiftHours({ s: "00:00", e: sh.e }), c, week: weekOf(next), spill: next > p.end });
        }
      });
  });
  return lines.sort((a, b) => (a.date + a.s < b.date + b.s ? -1 : a.date + a.s > b.date + b.s ? 1 : 0));
}

/* ---- totals ---- */
/* -> { rows: [{code, w1, w2}], w1, w2, total } */
function summary(periodId) {
  const by = {};
  let w1 = 0, w2 = 0;
  formLines(periodId).forEach(l => {
    by[l.c] = by[l.c] || { code: l.c, w1: 0, w2: 0 };
    by[l.c]["w" + l.week] += l.hours;
    if (l.week === 1) w1 += l.hours; else w2 += l.hours;
  });
  const rows = Object.values(by).sort((a, b) => (b.w1 + b.w2) - (a.w1 + a.w2));
  return { rows, w1, w2, total: w1 + w2 };
}

/* ---- checks ---- */
/* Problems with one shift's times: [{level, text, field}] (field "s"/"e"). */
function shiftProblems(sh) {
  const out = [];
  ["s", "e"].forEach(k => {
    const name = k === "s" ? "start" : "end";
    const r = parseTime(sh[k + "In"], sh[k + "Ap"]);
    if (r.bad) out.push({ level: "error", field: k, text: "The " + name + " time isn't a time (try 8:30)." });
    else if (r.needAp) out.push({ level: "error", field: k, text: "Choose AM or PM for the " + name + " time." });
  });
  if (!out.length) {
    if (sh.s && !sh.e && !sh.eIn) out.push({ level: "warn", field: "e", text: "Missing end time." });
    if (!sh.s && sh.e && !sh.sIn) out.push({ level: "warn", field: "s", text: "Missing start time." });
    if (sh.s && sh.e && sh.s === sh.e) out.push({ level: "error", field: "e", text: "Start and end are the same time." });
  }
  return out;
}

/* -> [{level: "error"|"warn", text}] for the whole pay period */
function problems(periodId) {
  const out = [], data = periodData(periodId), lines = formLines(periodId), p = periodById(periodId || state.cur);
  const pr = state.profile;
  if (!pr.workerNo) out.push({ level: "error", text: "Participant-Hired Worker Number is required (Defaults card)." });
  if (!pr.workerName) out.push({ level: "warn", text: "Worker name is empty (Defaults card)." });
  if (!pr.participant) out.push({ level: "warn", text: "Participant name is empty (Defaults card)." });
  if (!lines.length) out.push({ level: "warn", text: "No shifts entered yet." });
  if (lines.length > FORM_LINES) out.push({ level: "error", text: "The form holds " + FORM_LINES + " lines; this period needs " + lines.length + ". Combine or remove shifts." });
  const codes = new Set(lines.map(l => l.c));
  if (codes.size > FORM_CODES) out.push({ level: "warn", text: "The weekly totals box holds " + FORM_CODES + " service codes; you used " + codes.size + ". Only the top " + FORM_CODES + " print there (daily lines still print all)." });
  Object.keys(data.days).sort().forEach(date => {
    const dayName = shortDate(date);
    data.days[date].forEach(sh => shiftProblems(sh).forEach(x => out.push({ level: x.level, text: dayName + ": " + x.text })));
  });
  // overlaps, per form date (includes carried and after-midnight parts)
  const byDate = {};
  allLines(periodId).forEach(l => (byDate[l.date] = byDate[l.date] || []).push([toMin(l.s), l.e === "00:00" ? 1440 : toMin(l.e)]));
  Object.keys(byDate).forEach(d => {
    const r = byDate[d].sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < r.length; i++) if (r[i][0] < r[i - 1][1]) { out.push({ level: "error", text: shortDate(d) + ": two shifts overlap." }); break; }
  });
  carriedLines(periodId).forEach(l => out.push({ level: "warn", text: "Includes 12:00 AM – " + label12(l.e) + " on " + shortDate(l.date) + ", carried from the overnight shift of " + shortDate(l.from) + " (previous timesheet)." }));
  if (allLines(periodId).some(l => l.spill)) out.push({ level: "warn", text: "A shift on the last night runs past midnight. The after-midnight part goes on the next timesheet automatically." });
  if (p && !p.official) out.push({ level: "warn", text: "This pay period's dates are estimated. Check them against iLIFE's new schedule." });
  if (!(data.sigWImg || data.sigW) || !(data.sigPImg || data.sigP)) out.push({ level: "warn", text: "Both signatures and dates are required (sign here or on paper)." });
  [["sigW", "Worker"], ["sigP", "Participant"]].forEach(([k, who]) => {
    if (data[k] && data[k] < p.end) out.push({ level: "warn", text: who + " signature date is before the pay period ends (" + shortDate(p.end) + ")." });
  });
  return out;
}
