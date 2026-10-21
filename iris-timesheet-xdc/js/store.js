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
 *   exportDefaults() / importDefaults()  v1.1: save the Defaults card
 *               (worker number, names, codes, suggestion settings) to a
 *               .json file in a chat, and load it into a fresh copy of
 *               the app. (Each copy of an .xdc keeps its own storage.)
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

/* Fill in anything older saved data lacks (new defaults, v1.0 shifts). */
function upgrade(s) {
  const b = blankState();
  s.profile = Object.assign({}, b.profile, s.profile || {});
  delete s.profile.quick;   // v1.3: quick-pick times removed
  if (!Array.isArray(s.codes) || !s.codes.length) s.codes = b.codes;
  s.periods = s.periods || {};
  Object.values(s.periods).forEach(pd => Object.values(pd.days || {}).forEach(list => list.forEach(migrateShift)));
  if (s.syncOn === undefined) s.syncOn = true;
  return s;
}

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.profile && s.periods) state = upgrade(Object.assign(blankState(), s));
  } catch (e) { /* private mode or bad data: keep blank state */ }
  state.cur = defaultPeriodId();   // always open on the period due now
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

/* onChange(): called once after a batch of updates from someone else
   was merged (only when something actually changed). */
function startSync(onChange) {
  if (!hasXdc()) return;
  let pending = false;
  window.webxdc.setUpdateListener(u => {
    const m = u.payload || {};
    if (state.syncOn) {
      if (m.kind === "profile" && m.profile && (m.ts || 0) > (state.profileTs || 0)) {
        state.profile = m.profile; state.codes = m.codes; state.profileTs = m.ts;
        upgrade(state); pending = true;
      } else if (m.kind === "period" && m.data && periodById(m.id) && (m.data.ts || 0) > ((state.periods[m.id] || {}).ts || 0)) {
        state.periods[m.id] = m.data;
        upgrade(state); pending = true;
      }
    }
    if (pending && u.serial === u.max_serial) { pending = false; writeLocal(); onChange(); }
  }, 0);
}

/* ---- v1.1: defaults to / from a file ---- */
const DEFAULTS_FILE = "iris-timesheet-defaults.json";
async function exportDefaults() {
  if (!(hasXdc() && typeof window.webxdc.sendToChat === "function")) throw new Error("needs Delta Chat");
  const json = JSON.stringify({ app: "iris-timesheet", v: 1, profile: state.profile, codes: state.codes }, null, 1);
  await window.webxdc.sendToChat({ file: { name: DEFAULTS_FILE, plainText: json }, text: "IRIS Timesheet defaults" });
}
/* -> true when defaults were loaded */
async function importDefaults() {
  if (!(hasXdc() && typeof window.webxdc.importFiles === "function")) throw new Error("needs a newer Delta Chat");
  const files = await window.webxdc.importFiles({ extensions: [".json"], multiple: false });
  if (!files || !files.length) return false;
  const d = JSON.parse(await files[0].text());
  if (!d || d.app !== "iris-timesheet" || !d.profile) throw new Error("not an IRIS Timesheet defaults file");
  state.profile = d.profile;
  if (Array.isArray(d.codes) && d.codes.length) state.codes = d.codes;
  upgrade(state);
  save("profile");
  return true;
}
