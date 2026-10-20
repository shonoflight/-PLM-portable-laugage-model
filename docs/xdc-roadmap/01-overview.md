# 01 — Overview: webxdc transport, privacy & compression roadmap

> **Generated with:** Claude Code
> **Document set:** `01-overview.md` (this file) → `02-testing-plan.md` → `03-implementation-plan-rust.md`

## About this document

| | |
|---|---|
| **Purpose** | Sums up everything discussed so far about webxdc, and turns it into one plan. |
| **Depends on** | Nothing. Read this first. |
| **Relationship** | `02-testing-plan.md` sets out how each track is tested. `03-implementation-plan-rust.md` sets out how the main build (Track D) is written in Rust. |
| **Existing code** | `iris-timesheet-xdc/` is an existing webxdc app in this repo. It's the first real test case. |
| **How to edit** | Each track below stands alone. Add a new track as a new `### Track X` section, and update the Roadmap table. |

---

## 1. What we covered

| # | Topic | Key conclusion |
|---|---|---|
| 1 | **What webxdc is** | In-chat mini apps: a ZIP of HTML, CSS and JS with no network access. Each copy of the app shares state through the chat. They're local-first and peer-to-peer, the open alternative to WeChat and Telegram mini apps. |
| 2 | **Building our own** | Two paths: (1) write a webxdc app (easy, runs everywhere), or (2) write a full messenger (XMPP and/or email, a large job). |
| 3 | **Where webxdc runs** | Email: Delta Chat, ArcaneChat, DeltaTouch. XMPP: Cheogram, monocles. Realtime peer-to-peer: Iroh (mainly Delta Chat). No support found on Matrix, Signal, Telegram, WhatsApp or SimpleX. |
| 4 | **WhatsApp** | Not possible. The network is closed and its terms ban unofficial clients. The only official routes are the Business API and Flows. Bridges (Slidge, mautrix) carry text and media only and risk a ban. EU users have an official route through the DMA third-party chats. |
| 5 | **Account bans** | Caused by breaking WhatsApp's terms: modified clients, automation, reverse engineering. Detected through client fingerprints and behaviour. |
| 6 | **Future of email** | Email changes by adding layers (JMAP, Autocrypt, chatmail, MTA-STS), not by being replaced. |
| 7 | **IM2000 and DIME** | Both tried to replace SMTP rather than extend it, and both failed. Lesson: backward compatibility wins. |
| 8 | **DIME and Lavabit** | Lavabit (2013) showed that if a provider *can* read mail, it can be forced to. DIME splits metadata so no single server sees the whole picture. |
| 9 | **Delta Chat + DIME-style privacy** | Three levels: (1) settings (chatmail, Tor or proxy, separate profiles); (2) core changes (an address per contact, padding, timing noise, cover traffic); (3) layered relay routing as an opt-in extension. |
| 10 | **Realtime channels** | `joinRealtimeChannel()` is fast peer-to-peer over Iroh (QUIC), sends bytes only and stores nothing. It can expose IP addresses, so it should be opt-in and always have a fallback. |
| 11 | **All transport layers** | The webxdc stack (email, XMPP, Iroh), other networks that could host it (Nostr, SimpleX, Reticulum, Matrix, etc.), and the low-level protocols (TCP, UDP, QUIC, SCTP, DCCP). |
| 12 | **A faster transport** | Hybrid delivery: send each update over a fast P2P path *and* a stored path, and drop the duplicate. Add QUIC, compact encoding, MLS. Limited by the anonymity trilemma (strong anonymity, low latency and low bandwidth: pick two). |
| 13 | **Better compression** | Shared library cache (needs a spec change), Zopfli, zstd, modern media formats, and app size reduction you can do today. |
| 14 | **Beating Zopfli** | Realistic target: **about 1–3% smaller and 10–100× faster**, staying Deflate-compatible. The biggest lever is reshaping the input before compressing it. |

---

## 2. Decisions so far

1. **Work with the existing webxdc spec.** No custom messenger, and no WhatsApp.
2. **Target hosts:** Delta Chat (email), Cheogram and monocles (XMPP).
3. **Privacy:** use realtime channels only with an opt-in switch and a fallback. Never send sensitive content over them.
4. **Compression output must stay standard Deflate inside standard ZIP.** It has to open in every host with no changes.
5. **Measure first, build second.** Benchmark existing tools (Zopfli, ECT, libdeflate level 12, 7-Zip) before building a custom compressor.

---

## 3. Roadmap tracks

### Track A — Webxdc apps (in progress)
- `iris-timesheet-xdc/` exists (v1.2).
- Next: a starter template (manifest, `sendUpdate` chat, optional realtime module with feature detection).

### Track B — Privacy (not started; mostly configuration and design)
- Level 1: write a setup guide (chatmail, proxy or Tor, separate profiles).
- Levels 2–3: design work only. These need changes to the Delta Chat core, which is Rust and lives upstream.

### Track C — Faster transport (research only)
- Hybrid fast-plus-durable delivery. This would be a design proposal to the Delta Chat / chatmail project.
- No work in this repo beyond the design write-up.

### Track D — `.xdc` compression (**the main build**: see 03)
- A Rust tool, **`xdc-squeeze`**, that:
  1. packs a webxdc folder into the smallest valid `.xdc`,
  2. chooses the best method per file (store or optimized Deflate),
  3. includes its own optimizing Deflate encoder that aims to beat Zopfli on speed and match or beat it on size.

### Track E — Shared library cache (proposal only)
- Content-addressed libraries declared in `manifest.toml` by SHA-256.
- Needs agreement from the webxdc spec maintainers. Write an RFC-style proposal after Track D shows how much libraries cost.

---

## 4. Baseline facts from this repo

Measured on `iris-timesheet-xdc/iris-timesheet.xdc`, built with `zip -9`:

| File | Raw (bytes) | Zipped (bytes) | Share of `.xdc` |
|---|---:|---:|---:|
| `vendor/pdf-lib.min.js` | 525,099 | 206,627 | **57%** |
| `form/iris-timesheet.pdf` | 274,582 | 125,803 | **35%** |
| All app JS + CSS + HTML | ~75,000 | ~27,500 | ~8% |
| **Total** | **880,151** | **363,516** | 100% |

**What this shows:** one third-party library plus one PDF make up 92% of the app. Track D's per-file optimization and Track E's shared library cache would both have their biggest effect here.

---

## 5. Roadmap

| Phase | Track | Deliverable | Depends on |
|---|---|---|---|
| 0 | D | Benchmark harness and baseline numbers | — |
| 1 | D | `xdc-squeeze` packer using existing encoders | 0 |
| 2 | D | Own Deflate encoder, correct output first | 1 |
| 3 | D | Optimal parser, cost iteration, early stop | 2 |
| 4 | D | Block splitting by dynamic programming, joint header tuning | 3 |
| 5 | D | Binary-tree match finder, multi-core | 3 |
| 6 | A | Starter webxdc template that uses `xdc-squeeze` | 1 |
| 7 | B | Privacy setup guide (Level 1) | — |
| 8 | E | Shared library cache proposal, with data from Phase 0 | 0 |
| 9 | C | Hybrid transport design document | — |

---

## 6. Open questions

1. Should `xdc-squeeze` live in this repo, or in its own repo?
2. Is the PDF form in `iris-timesheet-xdc` already compressed inside? If so, storing it uncompressed in the ZIP may cost almost nothing (check in Phase 0).
3. Is there a minimum supported version for Delta Chat, Cheogram and monocles? This affects whether zstd could ever be used.
4. Who will maintain Track E's proposal with the upstream webxdc project?
