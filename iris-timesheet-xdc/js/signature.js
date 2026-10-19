/* =====================================================================
 * signature.js — finger / mouse signature pad
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   askSignature(title) -> Promise<string|null>
 *     Opens a full-width pop-up with a drawing area. "Done" returns the
 *     signature as a small PNG data URL (cropped to the ink, transparent
 *     background); "Cancel" returns null; "Clear" wipes the pad.
 *   The PNG is stored in the pay period (js/model.js) and placed on the
 *   form's signature line by js/pdffill.js.
 *
 * TO CHANGE: INK_COLOR / PEN_WIDTH below; OUT_HEIGHT = pixel height of the
 *   saved image (smaller = smaller sync messages).
 *
 * DEPENDENCIES   none (uses styles.css classes .sigpop, .sigpad)
 * RELATIONSHIP   called by js/fill.js (Signatures card).
 * ===================================================================== */

const INK_COLOR = "#0b2a6b", PEN_WIDTH = 2.6, OUT_HEIGHT = 90;

function askSignature(title) {
  return new Promise(resolve => {
    const pop = document.createElement("div");
    pop.className = "sigpop";
    pop.innerHTML = '<div class="sigbox"><p class="cap b"></p><canvas class="sigpad"></canvas>' +
      '<div class="sigact"><button type="button" data-a="cancel">Cancel</button>' +
      '<button type="button" data-a="clear">Clear</button>' +
      '<button type="button" class="primary" data-a="done">Done</button></div></div>';
    pop.querySelector("p").textContent = title;
    document.body.appendChild(pop);

    const c = pop.querySelector("canvas"), ctx = c.getContext("2d");
    const ratio = window.devicePixelRatio || 1;
    c.width = c.clientWidth * ratio; c.height = c.clientHeight * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = PEN_WIDTH; ctx.lineCap = ctx.lineJoin = "round"; ctx.strokeStyle = INK_COLOR;
    let drawing = false, used = false;
    const pos = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener("pointerdown", e => { drawing = used = true; c.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.moveTo(...pos(e)); e.preventDefault(); });
    c.addEventListener("pointermove", e => { if (!drawing) return; ctx.lineTo(...pos(e)); ctx.stroke(); e.preventDefault(); });
    c.addEventListener("pointerup", () => { drawing = false; });

    const close = v => { pop.remove(); resolve(v); };
    pop.addEventListener("click", e => {
      const a = e.target.dataset.a;
      if (a === "cancel") close(null);
      else if (a === "clear") { ctx.clearRect(0, 0, c.width, c.height); used = false; }
      else if (a === "done") close(used ? cropToInk(c) : null);
    });
  });
}

/* Cut the canvas down to the drawn area and scale to OUT_HEIGHT px tall. */
function cropToInk(c) {
  const ctx = c.getContext("2d"), { width: W, height: H } = c;
  const px = ctx.getImageData(0, 0, W, H).data;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (px[(y * W + x) * 4 + 3] > 20) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 <= x0 || y1 <= y0) return null;
  const pad = 4, w = x1 - x0 + pad * 2, h = y1 - y0 + pad * 2, k = OUT_HEIGHT / h;
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w * k)); out.height = OUT_HEIGHT;
  out.getContext("2d").drawImage(c, x0 - pad, y0 - pad, w, h, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
