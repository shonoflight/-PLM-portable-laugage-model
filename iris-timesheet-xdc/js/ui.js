/* =====================================================================
 * ui.js — pop-ups and short notices (v1.1)
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   el(tag, cls, text)            tiny element helper used everywhere
 *   askConfirm(text, yes, no)     -> Promise<boolean>. Own pop-up instead
 *        of window.confirm(), which some Delta Chat webviews block or
 *        answer silently. Escape = no.
 *   showToast(text, level, ms)    short notice at the bottom of the
 *        screen (level "warn" = red), e.g. "Choose AM or PM".
 *
 * TO CHANGE: look of pop-ups/toasts = .ask / .toast in styles.css.
 *
 * DEPENDENCIES   none
 * RELATIONSHIP   used by js/fill.js and js/app.js. Loaded before them.
 * ===================================================================== */

function el(tag, cls, txt) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (txt != null) e.textContent = txt;
  return e;
}

function askConfirm(text, yes, no) {
  return new Promise(resolve => {
    const prev = document.activeElement;
    const shade = el("div", "ask"), box = el("div", "ask-box");
    box.setAttribute("role", "dialog"); box.setAttribute("aria-modal", "true");
    const p = el("p"); p.textContent = text; p.style.whiteSpace = "pre-line";
    const btns = el("div", "ask-btns");
    const n = el("button", "", no || "Cancel"), y = el("button", "primary", yes || "OK");
    n.type = y.type = "button";
    const done = v => { shade.remove(); document.removeEventListener("keydown", key); if (prev && prev.focus) prev.focus(); resolve(v); };
    const key = e => { if (e.key === "Escape") done(false); };
    n.onclick = () => done(false); y.onclick = () => done(true);
    document.addEventListener("keydown", key);
    btns.append(n, y); box.append(p, btns); shade.appendChild(box);
    document.body.appendChild(shade);
    y.focus();
  });
}

let _toastTimer = null;
function showToast(text, level, ms) {
  let t = document.getElementById("toast");
  if (!t) {
    t = el("div", "toast"); t.id = "toast";
    t.setAttribute("role", "status"); t.setAttribute("aria-live", "polite");
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.className = "toast show" + (level ? " " + level : "");
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.classList.remove("show"), ms || 4000);
}
