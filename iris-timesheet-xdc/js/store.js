/* =====================================================================
 * store.js — saving on this device + sharing through the chat
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   save()      writes `state` to localStorage right away and, when Sync
 *               is on, sends the changed parts to the chat (debounced so
 *               typing doesn't flood it).
 *   load()      reads `state` back on start (falls back to a blank one).
 *   startSync(onChange)  listens for updates from other chat members.
 *               Each pay period and the profile carry a time stamp (ts);
 *               the newest version wins, so two people (worker and
 *               participant) can both work on the same timesheet.
 *   Outside Delta Chat (plain browser) it just saves locally.
 *
 * TO CHANGE: SYNC_DELAY_MS = how long to wait after the last edit before
 *   sending; STORAGE_KEY = rename to start fresh.
 *
 * DEPENDENCIES   webxdc.js (optional), js/model.js (state, blankState)
 * RELATIONSHIP   js/fill.js calls save() after every edit; js/app.js
 *                calls load() + startSync() on start.
 * ===================================================================== */

const STORAGE_KEY = "iris-timesheet-v1";
const SYNC_DELAY_MS = 2000;
const hasXdc = () => typeof window.webxdc !== "undefined" && typeof window.webxdc.sendUpdate === "function";

let _dirty = { profile: false, periods: new Set() }, _timer = null;

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.profile && s.periods) {
      state = Object.assign(blankState(), s);
      if (!periodById(state.cur)) state.cur = defaultPeriodId();
    }
  } catch (e) { /* private mode or bad data: keep blank state */ }
  if (state.syncOn === undefined) state.syncOn = true;
}

function writeLocal() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
}

/* what: "profile" or a period id */
function save(what) {
  const now = Date.now();
  if (what === "profile") { state.profileTs = now; _dirty.profile = true; }
  else if (what) { periodData(what).ts = now; _dirty.periods.add(what); }
  writeLocal();
  if (!hasXdc() || !state.syncOn) return;
  clearTimeout(_timer);
  _timer = setTimeout(flush, SYNC_DELAY_MS);
}

function flush() {
  if (!hasXdc() || !state.syncOn) return;
  if (_dirty.profile) {
    window.webxdc.sendUpdate({ payload: { kind: "profile", ts: state.profileTs, profile: state.profile, codes: state.codes } }, "");
  }
  _dirty.periods.forEach(id => {
    window.webxdc.sendUpdate({ payload: { kind: "period", id, data: state.periods[id] } }, "");
  });
  _dirty = { profile: false, periods: new Set() };
}
window.addEventListener("pagehide", flush);

/* onChange(): called after an update from someone else was merged. */
function startSync(onChange) {
  if (!hasXdc()) return;
  window.webxdc.setUpdateListener(u => {
    if (!state.syncOn) return;
    const m = u.payload || {};
    let changed = false;
    if (m.kind === "profile" && (m.ts || 0) > (state.profileTs || 0)) {
      state.profile = m.profile; state.codes = m.codes; state.profileTs = m.ts; changed = true;
    } else if (m.kind === "period" && m.data && (m.data.ts || 0) > ((state.periods[m.id] || {}).ts || 0)) {
      state.periods[m.id] = m.data; changed = true;
    }
    if (changed) { writeLocal(); if (u.serial === u.max_serial) onChange(); }
  }, 0);
}
