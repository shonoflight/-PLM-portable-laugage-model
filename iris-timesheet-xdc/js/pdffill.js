/* =====================================================================
 * pdffill.js — fills in the OFFICIAL iLIFE IRIS timesheet PDF
 * Generated with: Claude Opus 5.5 (claude-opus-5-5)
 * ---------------------------------------------------------------------
 * WHAT IT DOES
 *   buildTimesheetPdf(periodId) -> Promise<Uint8Array>
 *     Loads form/iris-timesheet.pdf (the blank fillable form, shipped
 *     inside the .xdc), writes every value into its form fields, ticks
 *     the AM/PM boxes and returns the finished file. The result is the
 *     real iLIFE form, still fillable, with both pages (schedule incl.).
 *     Signatures drawn in the app (js/signature.js) are placed on the
 *     signature lines (SIG_BOX below, PDF points from the bottom-left).
 *   pdfFileName(periodId) -> "IRIS-Timesheet-P22-2026-10-03-Name.pdf"
 *
 *   Field names on the form (checked with pdf-lib, 244 fields):
 *     header   "ParticipantHired Worker Number" / "...Name", "Participant Name",
 *              "Pay Period End Date" (mm/dd/yyyy)
 *     totals   "Service CodeRow1..4", "Week 1Row1..4", "Week 2Row1..4",
 *              "Week 1TOTAL HOURS", "Week 2TOTAL HOURS"
 *     lines    "Date WorkedRowN" (mm/dd), "Start TimeRowN", "End TimeRowN"
 *              (hh:mm), "RowN_Start_AM-PM" / "RowN_End_AM-PM" (one field,
 *              two boxes: AM and PM), "Hours WorkedRowN",
 *              service code: "Service CodeRowN_2" for N 1-4, else "Service CodeRowN"
 *     signing  "Date_1" (worker signature date), "Date_2" (participant)
 *   If iLIFE releases a new form version, update FIELD below.
 *
 * DEPENDENCIES   vendor/pdf-lib.min.js (window.PDFLib, MIT licence),
 *                js/schedule.js, js/model.js
 * RELATIONSHIP   js/app.js calls it from the "Make PDF" button.
 * ===================================================================== */

const FORM_URL = "form/iris-timesheet.pdf";
const FIELD = {
  workerNo: "ParticipantHired Worker Number",
  workerName: "ParticipantHired Worker Name",
  participant: "Participant Name",
  periodEnd: "Pay Period End Date",
  sumCode: i => "Service CodeRow" + i,
  sumW1: i => "Week 1Row" + i,
  sumW2: i => "Week 2Row" + i,
  totW1: "Week 1TOTAL HOURS",
  totW2: "Week 2TOTAL HOURS",
  date: n => "Date WorkedRow" + n,
  start: n => "Start TimeRow" + n,
  startAP: n => "Row" + n + "_Start_AM-PM",
  end: n => "End TimeRow" + n,
  endAP: n => "Row" + n + "_End_AM-PM",
  hours: n => "Hours WorkedRow" + n,
  code: n => (n <= 4 ? "Service CodeRow" + n + "_2" : "Service CodeRow" + n),
  sigW: "Date_1",
  sigP: "Date_2",
};
const LINE_FONT_SIZE = 9;
const SIG_BOX = {               // where drawn signatures go on page 1
  sigWImg: { x: 102, y: 45, w: 190, h: 22 },   // Participant-Hired Worker Signature
  sigPImg: { x: 102, y: 19, w: 190, h: 22 },   // Participant Signature
};

/* "2026-10-03" -> "10/03" or "10/03/2026" (the form's own formats) */
function formDate(iso, withYear) {
  const [y, m, d] = iso.split("-");
  return m + "/" + d + (withYear ? "/" + y : "");
}

function pdfFileName(periodId) {
  const p = periodById(periodId), who = (state.profile.workerName || "").trim().replace(/[^A-Za-z0-9]+/g, "-");
  return "IRIS-Timesheet-" + (p.official ? p.id + "-" : "") + p.end + (who ? "-" + who : "") + ".pdf";
}

async function buildTimesheetPdf(periodId) {
  const { PDFDocument, PDFName, StandardFonts } = window.PDFLib;
  const res = await fetch(FORM_URL);
  if (!res.ok) throw new Error("blank form missing from the app (" + FORM_URL + ")");
  const doc = await PDFDocument.load(await res.arrayBuffer());
  const form = doc.getForm();
  const helv = await doc.embedFont(StandardFonts.Helvetica);

  const text = (name, value, size) => {
    const f = form.getTextField(name);
    if (size) f.setFontSize(size);
    f.setText(value == null ? "" : String(value));
  };
  /* One AM/PM field has two boxes; turn on the one named `which`. */
  const ampm = (name, which) => {
    const f = form.getCheckBox(name);
    f.acroField.dict.set(PDFName.of("V"), PDFName.of(which));
    f.acroField.getWidgets().forEach(w => {
      const on = w.getOnValue();
      w.setAppearanceState(on && on.decodeText && on.decodeText() === which ? on : PDFName.of("Off"));
    });
  };

  const p = periodById(periodId), data = periodData(periodId), pr = state.profile;
  text(FIELD.workerNo, pr.workerNo);
  text(FIELD.workerName, pr.workerName);
  text(FIELD.participant, pr.participant);
  text(FIELD.periodEnd, formDate(p.end, true));

  const sum = summary(periodId);
  sum.rows.slice(0, FORM_CODES).forEach((r, i) => {
    text(FIELD.sumCode(i + 1), r.code, LINE_FONT_SIZE);
    text(FIELD.sumW1(i + 1), r.w1 ? fmtHours(r.w1) : "", LINE_FONT_SIZE);
    text(FIELD.sumW2(i + 1), r.w2 ? fmtHours(r.w2) : "", LINE_FONT_SIZE);
  });
  text(FIELD.totW1, fmtHours(sum.w1), LINE_FONT_SIZE);
  text(FIELD.totW2, fmtHours(sum.w2), LINE_FONT_SIZE);

  formLines(periodId).slice(0, FORM_LINES).forEach((l, i) => {
    const n = i + 1, s = to12(l.s), e = to12(l.e);
    text(FIELD.date(n), formDate(l.date), LINE_FONT_SIZE);
    text(FIELD.start(n), s.t, LINE_FONT_SIZE);
    ampm(FIELD.startAP(n), s.ap);
    text(FIELD.end(n), e.t, LINE_FONT_SIZE);
    ampm(FIELD.endAP(n), e.ap);
    text(FIELD.hours(n), fmtHours(l.hours), LINE_FONT_SIZE);
    text(FIELD.code(n), l.c, LINE_FONT_SIZE);
  });

  const page = doc.getPages()[0];
  for (const key of Object.keys(SIG_BOX)) {
    if (!data[key]) continue;
    const img = await doc.embedPng(data[key]);
    const b = SIG_BOX[key], k = Math.min(b.w / img.width, b.h / img.height);
    page.drawImage(img, { x: b.x, y: b.y, width: img.width * k, height: img.height * k });
  }
  if (data.sigW) text(FIELD.sigW, formDate(data.sigW, true));
  if (data.sigP) text(FIELD.sigP, formDate(data.sigP, true));

  form.updateFieldAppearances(helv);
  return doc.save();
}
