/* =====================================================================
 * app.js — start-up, bottom bar, Make PDF — runs last
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   • On start: load() saved data, draw the screen, start chat sync.
 *   • Bottom bar:
 *       Clear period  wipes this pay period's shifts + signatures (asks first)
 *       Sync on/off   share edits with the chat (worker ↔ participant)
 *       Make PDF      fills the official iLIFE form (js/pdffill.js) and
 *                     puts it in a chat draft (Delta Chat) or downloads
 *                     it (plain browser). Errors block it; warnings ask.
 *   • setStatus(text) writes the small green line under the top bar.
 *
 * DEPENDENCIES   everything in js/ (see index.html load order)
 * RELATIONSHIP   index.html loads it last.
 * ===================================================================== */

function setStatus(t) { document.getElementById("sync").textContent = t || ""; }

function updateBar() {
  const s = document.getElementById("syncBtn");
  s.textContent = "Sync: " + (state.syncOn ? "on" : "off");
  s.classList.toggle("hidden", !hasXdc());
}

function bytesToBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function makePdf() {
  const list = problems(), errs = list.filter(x => x.level === "error");
  if (errs.length) {
    setStatus("Fix first: " + errs.map(x => x.text).join(" "));
    document.getElementById("totals").scrollIntoView({ behavior: "smooth" });
    return;
  }
  const warns = list.filter(x => x.level === "warn");
  if (warns.length && !confirm("Make the PDF anyway?\n\n• " + warns.map(x => x.text).join("\n• "))) return;
  try {
    setStatus("Filling in the iLIFE form…");
    const bytes = await buildTimesheetPdf(state.cur);
    const name = pdfFileName(state.cur), sum = summary();
    const text = "IRIS timesheet " + periodById(state.cur).label + " — " + fmtHours(sum.total) + " hours";
    if (hasXdc() && typeof window.webxdc.sendToChat === "function") {
      setStatus("Pick a chat for the PDF.");
      await window.webxdc.sendToChat({ file: { name, base64: bytesToBase64(bytes) }, text });
      setStatus("PDF is in the draft. Send it, then forward it to IRIS.TimeReports@iLIFE.org.");
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setStatus("PDF downloaded: " + name);
    }
  } catch (err) {
    setStatus("Could not make the PDF: " + (err && err.message ? err.message : err));
  }
}

document.getElementById("pdf").onclick = makePdf;
document.getElementById("clear").onclick = () => {
  if (!confirm("Clear all shifts and signatures for " + periodById(state.cur).label + "?")) return;
  state.periods[state.cur] = { days: {}, sigW: "", sigP: "", ts: 0 };
  save(state.cur); renderFill(); setStatus("Pay period cleared.");
};
document.getElementById("syncBtn").onclick = () => {
  state.syncOn = !state.syncOn; save(); updateBar();
  setStatus(state.syncOn ? "Sync on: changes are shared with this chat." : "Sync off: changes stay on this device.");
};

load();
renderFill();
startSync(() => { renderFill(); setStatus("Updated from the chat."); });
