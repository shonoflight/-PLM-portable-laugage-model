/* =====================================================================
 * model.js — timesheet data + all the automatic math
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   1. The data shape (one global `state`, saved by js/store.js):
 *        state.profile  {workerNo, workerName, participant, defCode}
 *        state.codes    service code list [{code, name}]
 *        state.cur      id of the pay period on screen
 *        state.periods  { periodId: { days: {"YYYY-MM-DD": [shift…]},
 *                                     sigW, sigP, ts } }
 *        shift          { s: "HH:MM", e: "HH:MM", c: "PC" }  (24-hour)
 *   2. Time math:
 *        snap15(t)      rounds a time to the nearest 15 minutes
 *        shiftHours(sh) hours worked, overnight-aware, in 0.25 steps
 *        to12(t)        "13:15" -> {t:"01:15", ap:"PM"} for the form
 *   3. Form lines:  formLines(periodId) turns the day cards into the
 *        rows the paper form wants. A shift that runs past midnight
 *        is split into two lines (one per date), as iLIFE requires.
 *   4. Totals:      summary(periodId) -> hours per service code per week
 *   5. Checks:      problems(periodId) -> list of warnings / errors
 *
 * TO CHANGE: service code list = DEFAULT_CODES; form size = FORM_LINES /
 *   FORM_CODES (rows on the official PDF).
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

function blankState() {
  return {
    profile: { workerNo: "", workerName: "", participant: "", defCode: "SHC" },
    codes: DEFAULT_CODES.map(c => Object.assign({}, c)),
    cur: defaultPeriodId(),
    periods: {},
  };
}
let state = blankState();

/* The record for one pay period (created empty on first use). */
function periodData(id) {
  id = id || state.cur;
  if (!state.periods[id]) state.periods[id] = { days: {}, sigW: "", sigP: "", ts: 0 };
  return state.periods[id];
}

/* ---- time math ---- */
const toMin = t => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
const fromMin = m => { m = ((m % 1440) + 1440) % 1440; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
function snap15(t) { return t ? fromMin(Math.round(toMin(t) / 15) * 15) : t; }
function is15(t) { return !t || toMin(t) % 15 === 0; }

/* Minutes worked. End at/before start = runs past midnight. */
function shiftMinutes(sh) {
  if (!sh.s || !sh.e) return 0;
  let d = toMin(sh.e) - toMin(sh.s);
  if (d <= 0) d += 1440;
  return d;
}
function shiftHours(sh) { return Math.round(shiftMinutes(sh) / 15) / 4; }
function fmtHours(h) { return h.toFixed(2); }

/* "13:15" -> { t: "01:15", ap: "PM" }   (noon = 12 PM, midnight = 12 AM) */
function to12(t) {
  const [h, m] = t.split(":").map(Number);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return { t: String(h12).padStart(2, "0") + ":" + String(m).padStart(2, "0"), ap: h < 12 ? "AM" : "PM" };
}
function label12(t) { if (!t) return ""; const x = to12(t); return x.t.replace(/^0/, "") + " " + x.ap; }

/* ---- form lines ---- */
/* One line per shift (two when it crosses midnight), sorted by date/time.
   Each line: {date, s, e, hours, c, week} — week is 1 or 2.
   The after-midnight part of a shift on the period's last night belongs
   to the NEXT timesheet, so it is left out (allLines keeps it, marked spill). */
function formLines(periodId) { return allLines(periodId).filter(l => !l.spill); }
function allLines(periodId) {
  const p = periodById(periodId || state.cur), data = periodData(periodId);
  const weekOf = iso => (iso < addDays(p.start, 7) ? 1 : 2);
  const lines = [];
  Object.keys(data.days).sort().forEach(date => {
    data.days[date].filter(sh => sh.s && sh.e)
      .sort((a, b) => toMin(a.s) - toMin(b.s))
      .forEach(sh => {
        const c = sh.c || state.profile.defCode;
        if (toMin(sh.e) > toMin(sh.s)) {
          lines.push({ date, s: sh.s, e: sh.e, hours: shiftHours(sh), c, week: weekOf(date) });
        } else {   // past midnight -> split at 12:00 AM
          const first = { s: sh.s, e: "00:00" }, next = addDays(date, 1);
          lines.push({ date, s: sh.s, e: "00:00", hours: shiftHours(first), c, week: weekOf(date) });
          if (sh.e !== "00:00") lines.push({ date: next, s: "00:00", e: sh.e, hours: shiftHours({ s: "00:00", e: sh.e }), c, week: weekOf(next), spill: next > p.end });
        }
      });
  });
  return lines.sort((a, b) => (a.date + a.s < b.date + b.s ? -1 : 1));
}

/* ---- totals ---- */
/* -> { rows: [{code, w1, w2}], w1, w2, total, days: {date: hours} } */
function summary(periodId) {
  const by = {}, days = {};
  let w1 = 0, w2 = 0;
  formLines(periodId).forEach(l => {
    by[l.c] = by[l.c] || { code: l.c, w1: 0, w2: 0 };
    by[l.c]["w" + l.week] += l.hours;
    if (l.week === 1) w1 += l.hours; else w2 += l.hours;
    days[l.date] = (days[l.date] || 0) + l.hours;
  });
  const rows = Object.values(by).sort((a, b) => (b.w1 + b.w2) - (a.w1 + a.w2));
  return { rows, w1, w2, total: w1 + w2, days };
}

/* Minutes of one day used by its shifts, as [start,end) ranges (overnight split). */
function dayRanges(shifts) {
  const r = [];
  shifts.filter(sh => sh.s && sh.e).forEach(sh => {
    const s = toMin(sh.s), e = toMin(sh.e);
    if (e > s) r.push([s, e]); else r.push([s, 1440]);
  });
  return r.sort((a, b) => a[0] - b[0]);
}

/* ---- checks ---- */
/* -> [{level: "error"|"warn", text}] */
function problems(periodId) {
  const out = [], data = periodData(periodId), lines = formLines(periodId), p = periodById(periodId || state.cur);
  const pr = state.profile;
  if (!pr.workerNo) out.push({ level: "error", text: "Participant-Hired Worker Number is required." });
  if (!pr.workerName) out.push({ level: "warn", text: "Worker name is empty." });
  if (!pr.participant) out.push({ level: "warn", text: "Participant name is empty." });
  if (!lines.length) out.push({ level: "warn", text: "No shifts entered yet." });
  if (lines.length > FORM_LINES) out.push({ level: "error", text: "The form holds " + FORM_LINES + " lines; this period needs " + lines.length + ". Combine or remove shifts." });
  const codes = new Set(lines.map(l => l.c));
  if (codes.size > FORM_CODES) out.push({ level: "warn", text: "The weekly totals box holds " + FORM_CODES + " service codes; you used " + codes.size + ". Only the top " + FORM_CODES + " print there (daily lines still print all)." });
  Object.keys(data.days).forEach(date => {
    const shifts = data.days[date];
    shifts.forEach(sh => {
      if ((sh.s && !sh.e) || (!sh.s && sh.e)) out.push({ level: "warn", text: shortDate(date) + ": a shift is missing its " + (sh.s ? "end" : "start") + " time." });
      if (!is15(sh.s) || !is15(sh.e)) out.push({ level: "error", text: shortDate(date) + ": times must be in 15-minute steps." });
    });
    const r = dayRanges(shifts);
    for (let i = 1; i < r.length; i++) if (r[i][0] < r[i - 1][1]) { out.push({ level: "error", text: shortDate(date) + ": two shifts overlap." }); break; }
  });
  if (allLines(periodId).some(l => l.spill)) out.push({ level: "warn", text: "A shift on the last night runs into the next pay period. The after-midnight part belongs on the next timesheet." });
  if (p && !p.official) out.push({ level: "warn", text: "This pay period's dates are estimated. Check them against iLIFE's new schedule." });
  if (!data.sigW || !data.sigP) out.push({ level: "warn", text: "Remember: both signatures and dates are required." });
  return out;
}
