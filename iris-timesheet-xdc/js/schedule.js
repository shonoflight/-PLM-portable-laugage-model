/* =====================================================================
 * schedule.js — iLIFE IRIS pay periods (2026 Payroll Payment Schedule)
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   Holds the official 2026 pay period table (page 2 of the blank form)
 *   and answers questions about it:
 *     allPeriods()        every period: {id, label, start, end, due, pay, official}
 *     periodById(id)      one period
 *     defaultPeriodId()   the period you most likely want to fill today:
 *                         the one whose submit window (end date → due date)
 *                         contains today, else the one today falls in.
 *     periodDays(p)       the 14 ISO dates of a period (Sun … Sat, Sun … Sat)
 *   Periods after P27 are ESTIMATED (+14 days, due = end + 6, pay = end + 20)
 *   and are marked official:false so the screen can warn about them.
 *
 * TO UPDATE FOR A NEW YEAR: paste the new rows into OFFICIAL below
 *   (id, start, end, due, pay as "YYYY-MM-DD"). Nothing else changes.
 *
 * DEPENDENCIES   none (load first after webxdc.js)
 * RELATIONSHIP   used by js/model.js (week split), js/fill.js (period
 *                picker), js/pdffill.js (Pay Period End Date).
 * ===================================================================== */

const OFFICIAL = [
  ["P1",  "2025-11-30", "2025-12-13", "2025-12-19", "2026-01-02"],
  ["P2",  "2025-12-14", "2025-12-27", "2026-01-02", "2026-01-16"],
  ["P3",  "2025-12-28", "2026-01-10", "2026-01-16", "2026-01-30"],
  ["P4",  "2026-01-11", "2026-01-24", "2026-01-30", "2026-02-13"],
  ["P5",  "2026-01-25", "2026-02-07", "2026-02-13", "2026-02-27"],
  ["P6",  "2026-02-08", "2026-02-21", "2026-02-27", "2026-03-13"],
  ["P7",  "2026-02-22", "2026-03-07", "2026-03-13", "2026-03-27"],
  ["P8",  "2026-03-08", "2026-03-21", "2026-03-27", "2026-04-10"],
  ["P9",  "2026-03-22", "2026-04-04", "2026-04-10", "2026-04-24"],
  ["P10", "2026-04-05", "2026-04-18", "2026-04-24", "2026-05-08"],
  ["P11", "2026-04-19", "2026-05-02", "2026-05-08", "2026-05-22"],
  ["P12", "2026-05-03", "2026-05-16", "2026-05-22", "2026-06-05"],
  ["P13", "2026-05-17", "2026-05-30", "2026-06-05", "2026-06-18"],
  ["P14", "2026-05-31", "2026-06-13", "2026-06-19", "2026-07-03"],
  ["P15", "2026-06-14", "2026-06-27", "2026-07-03", "2026-07-17"],
  ["P16", "2026-06-28", "2026-07-11", "2026-07-17", "2026-07-31"],
  ["P17", "2026-07-12", "2026-07-25", "2026-07-31", "2026-08-14"],
  ["P18", "2026-07-26", "2026-08-08", "2026-08-14", "2026-08-28"],
  ["P19", "2026-08-09", "2026-08-22", "2026-08-28", "2026-09-11"],
  ["P20", "2026-08-23", "2026-09-05", "2026-09-11", "2026-09-25"],
  ["P21", "2026-09-06", "2026-09-19", "2026-09-25", "2026-10-09"],
  ["P22", "2026-09-20", "2026-10-03", "2026-10-09", "2026-10-23"],
  ["P23", "2026-10-04", "2026-10-17", "2026-10-23", "2026-11-06"],
  ["P24", "2026-10-18", "2026-10-31", "2026-11-06", "2026-11-20"],
  ["P25", "2026-11-01", "2026-11-14", "2026-11-20", "2026-12-04"],
  ["P26", "2026-11-15", "2026-11-28", "2026-12-04", "2026-12-18"],
  ["P27", "2026-11-29", "2026-12-12", "2026-12-18", "2026-12-30"],
];
const ESTIMATED_AFTER = 13;   // how many guessed periods to add after the table

/* ---- ISO date helpers (local dates, no time zones involved) ---- */
function isoToDate(iso) { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); }
function dateToIso(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function addDays(iso, n) { const d = isoToDate(iso); d.setDate(d.getDate() + n); return dateToIso(d); }
function todayIso() { return dateToIso(new Date()); }
/* "2026-09-20" -> "9/20" or "9/20/2026" */
function shortDate(iso, withYear) {
  const [y, m, d] = iso.split("-").map(Number);
  return m + "/" + d + (withYear ? "/" + y : "");
}

let _periods = null;
function allPeriods() {
  if (_periods) return _periods;
  _periods = OFFICIAL.map(([id, start, end, due, pay]) => ({ id, start, end, due, pay, official: true }));
  let last = _periods[_periods.length - 1];
  for (let i = 0; i < ESTIMATED_AFTER; i++) {
    const start = addDays(last.start, 14), end = addDays(start, 13);
    last = { id: "E-" + start, start, end, due: addDays(end, 6), pay: addDays(end, 20), official: false };
    _periods.push(last);
  }
  _periods.forEach(p => {
    p.label = (p.official ? p.id + " · " : "") + shortDate(p.start) + " – " + shortDate(p.end, true) +
      (p.official ? "" : " (estimated)");
  });
  return _periods;
}
function periodById(id) { return allPeriods().find(p => p.id === id) || null; }

function defaultPeriodId() {
  const t = todayIso(), ps = allPeriods();
  const submitting = ps.find(p => t > p.end && t <= p.due);
  if (submitting) return submitting.id;
  const inside = ps.find(p => t >= p.start && t <= p.end);
  return (inside || ps[ps.length - 1]).id;
}

function periodDays(p) { return Array.from({ length: 14 }, (_, i) => addDays(p.start, i)); }
