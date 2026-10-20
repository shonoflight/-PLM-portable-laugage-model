# 03 — Implementation plan (Rust): `xdc-squeeze`

> **Generated with:** Claude Code
> **Document set:** `01-overview.md` → `02-testing-plan.md` → `03-implementation-plan-rust.md` (this file)

## About this document

| | |
|---|---|
| **Purpose** | Step-by-step plan for building `xdc-squeeze`, a Rust tool that packs a webxdc folder into the smallest valid `.xdc`, using its own optimizing Deflate encoder. This is Track D in `01-overview.md`. |
| **Depends on** | `01-overview.md` (goals, phases); `02-testing-plan.md` (tests and acceptance criteria for each phase). |
| **Relationship** | The `xdc-squeeze` CLI replaces the `zip -9` line in `iris-timesheet-xdc/build.sh`. The module names here match the test tables in `02`. |
| **How to edit** | Each module has its own section with a code outline. Change the outline and the phase table together. Settings in §4 (`Options`) are the only knobs, so new behaviour should add a field there rather than a hidden constant. |

**Note:** the Rust below is an outline: signatures, data types and comments. Function bodies are left as `todo!()` and get filled in phase by phase.

---

## 1. Goals and non-goals

**Goals**
1. Output is **standard ZIP + Deflate (RFC 1951)** and opens in every webxdc host.
2. Same size or smaller than `zopfli --i15`, and **≥ 10× faster** by Phase 5.
3. Deterministic output (byte-identical across runs and thread counts).
4. Each part is replaceable: every stage is a trait or a module with a small API.

**Non-goals**
- New compression formats (zstd, Brotli) inside `.xdc`: hosts can't read them.
- Rewriting app code (minification or bundling). Leave that to esbuild or Vite. `xdc-squeeze` only *reports* bundling opportunities.

---

## 2. Workspace layout

```
xdc-squeeze/
├── Cargo.toml                  # workspace
├── crates/
│   ├── deflate-opt/            # library: the optimizing Deflate encoder
│   │   └── src/
│   │       ├── lib.rs          # public API: compress(), Options
│   │       ├── bitwriter.rs    # LSB-first bit output
│   │       ├── huffman.rs      # length-limited codes (package-merge), header RLE
│   │       ├── symbols.rs      # Symbol, length/distance code tables (RFC 1951)
│   │       ├── match_finder.rs # hash chain (P2) → binary tree (P5)
│   │       ├── cost_model.rs   # bit cost per symbol, built from statistics
│   │       ├── parser.rs       # greedy (P2) → optimal shortest-path (P3)
│   │       ├── splitter.rs     # block boundaries: greedy (P3) → DP (P4)
│   │       ├── block.rs        # choose stored / fixed / dynamic; write a block
│   │       └── scheduler.rs    # per-block parallelism, early stop (P5)
│   ├── xdc-pack/               # library: .xdc container
│   │   └── src/
│   │       ├── lib.rs          # pack_dir()
│   │       ├── manifest.rs     # parse/validate manifest.toml
│   │       ├── preprocess.rs   # file classification, method choice, reports
│   │       ├── backend.rs      # trait Backend: own encoder | zopfli | libdeflate
│   │       └── zip_writer.rs   # deterministic ZIP writer
│   ├── xdc-bench/              # binary: benchmark harness (Phase 0)
│   └── xdc-squeeze/            # binary: CLI
├── testdata/                   # corpus C1–C5 + MANIFEST.sha256
├── fuzz/                       # cargo-fuzz targets
└── bench/results.csv
```

### Dependencies

| Crate | Used in | Why |
|---|---|---|
| `rayon` | `deflate-opt::scheduler`, `xdc-pack` | Multi-core work |
| `crc32fast` | `zip_writer` | ZIP CRC-32 |
| `toml`, `serde` | `manifest` | Reads `manifest.toml` |
| `clap` | `xdc-squeeze` | Command-line arguments |
| `walkdir` | `xdc-pack` | Lists the app folder |
| `zopfli` | `backend` (optional feature) | Baseline encoder, Phase 1 |
| `libdeflater` | `backend` (optional), tests | Fast encoder; a decoder for checks |
| `miniz_oxide`, `flate2` | dev-dependency | Independent decoders for tests |
| `proptest`, `criterion` | dev-dependency | Property tests, benchmarks |
| `sha2` | `preprocess` | File hashes (data for Track E) |

---

## 3. Phases

| Phase | Build | Done when (see `02` §9) |
|---|---|---|
| **0** | `xdc-bench`: runs external tools on the corpus, writes CSV | Baseline CSV committed |
| **1** | `xdc-pack` + CLI using the `zopfli`/`libdeflater` backends; per-file store-or-deflate; deterministic ZIP | `iris-timesheet.xdc` ≤ `advzip`; I1 passes |
| **2** | `deflate-opt` correct output: bitwriter, symbols, huffman, hash-chain match finder, greedy parse, single block | All correctness tests and fuzzing green |
| **3** | Optimal parser + iterated cost model + early stop + greedy splitter | Within 1% of Zopfli, ≥ 3× faster |
| **4** | DP splitter + joint header/data Huffman tuning + per-block type choice | ≤ Zopfli size on C1/C3 |
| **5** | Binary-tree match finder + per-block parallelism | ≥ 10× faster than Zopfli |

---

## 4. `deflate-opt` — public API (`lib.rs`)

```rust
//! deflate-opt — optimizing, standards-compliant Deflate (RFC 1951) encoder.
//!
//! SUMMARY
//!   compress(data, &Options) -> Vec<u8>   raw Deflate stream (no zlib/gzip wrapper)
//!   Pipeline: match_finder → parser (+cost_model, iterated) → splitter → block → bitwriter
//!
//! DEPENDENCIES  rayon (scheduler). No unsafe code.
//! RELATIONSHIP  Used by xdc-pack::backend::OwnBackend. Tests in 02-testing-plan §3–§4.
//! HOW TO CHANGE Every tuning knob lives in `Options`. Do not add hidden constants.

pub mod bitwriter;
pub mod block;
pub mod cost_model;
pub mod huffman;
pub mod match_finder;
pub mod parser;
pub mod scheduler;
pub mod splitter;
pub mod symbols;

/// All tuning settings in one place. `Options::level(n)` gives the presets.
#[derive(Clone, Debug)]
pub struct Options {
    /// Max optimal-parse passes per block (Zopfli uses ~15).
    pub max_iterations: u32,
    /// Stop iterating when a pass saves fewer than this many bits.
    pub early_stop_bits: u64,
    /// Which match finder to use.
    pub match_finder: MatchFinderKind,
    /// Which block splitter to use.
    pub splitter: SplitterKind,
    /// Worker threads; 0 = all cores. Output does not depend on this.
    pub threads: usize,
    /// Max candidate split points tried by the DP splitter.
    pub max_split_candidates: usize,
}

#[derive(Clone, Copy, Debug)]
pub enum MatchFinderKind { HashChain { max_chain: u32 }, BinaryTree }

#[derive(Clone, Copy, Debug)]
pub enum SplitterKind { None, Greedy, DynamicProgramming }

impl Options {
    /// 1 = fast … 9 = default … 12 = maximum.
    pub fn level(n: u8) -> Self { todo!("presets table, Phase 3") }
}

/// Compress `data` into a raw Deflate stream.
pub fn compress(data: &[u8], opts: &Options) -> Vec<u8> {
    let mf = match_finder::build(data, opts.match_finder);
    let blocks = splitter::split(data, &mf, opts);          // Vec<Range<usize>>
    let parsed = scheduler::parse_blocks(data, &mf, &blocks, opts); // parallel, ordered
    let mut out = bitwriter::BitWriter::with_capacity(data.len() / 2);
    for (i, pb) in parsed.iter().enumerate() {
        block::write_best(&mut out, data, pb, i + 1 == parsed.len());
    }
    out.finish()
}
```

---

## 5. Modules

### 5.1 `symbols.rs` — Deflate alphabets (Phase 2)

```rust
//! Deflate symbols and the fixed RFC 1951 length/distance code tables.

/// One unit of the parsed stream.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Symbol {
    Literal(u8),
    /// len 3..=258, dist 1..=32768
    Match { len: u16, dist: u16 },
}

pub const END_OF_BLOCK: u16 = 256;
pub const MIN_MATCH: usize = 3;
pub const MAX_MATCH: usize = 258;
pub const WINDOW: usize = 32_768;

/// (code 257..=285, extra_bits, extra_value) for a match length.
pub fn length_code(len: u16) -> (u16, u8, u16) { todo!() }
/// (code 0..=29, extra_bits, extra_value) for a distance.
pub fn dist_code(dist: u16) -> (u16, u8, u16) { todo!() }
```

### 5.2 `bitwriter.rs` — bit output (Phase 2)

```rust
//! Bit output, least-significant bit first, as Deflate requires.
//! Huffman codes are written bit-reversed (see `huffman::reverse_bits`).

pub struct BitWriter { buf: Vec<u8>, acc: u64, nbits: u32 }

impl BitWriter {
    pub fn with_capacity(n: usize) -> Self { todo!() }
    /// Append the low `n` bits of `v` (n ≤ 32).
    pub fn put(&mut self, v: u32, n: u32) { todo!() }
    /// Pad to a byte boundary (stored blocks).
    pub fn align(&mut self) { todo!() }
    pub fn bits_written(&self) -> u64 { todo!() }
    pub fn finish(self) -> Vec<u8> { todo!() }
}
```

### 5.3 `huffman.rs` — codes and headers (Phases 2, 4)

```rust
//! Length-limited Huffman codes (boundary package-merge) and the
//! dynamic-block header encoding (code-length alphabet with RLE 16/17/18).

/// Optimal code lengths with every length ≤ `max_bits`. Zero-frequency symbols get 0.
/// Edge case: fewer than 2 used symbols → assign length 1 so decoders accept the tree.
pub fn code_lengths(freqs: &[u32], max_bits: u8) -> Vec<u8> { todo!() }

/// Canonical codes from lengths (RFC 1951 §3.2.2), already bit-reversed.
pub fn canonical_codes(lengths: &[u8]) -> Vec<u16> { todo!() }

/// Header cost in bits for given literal/length + distance lengths,
/// trying every RLE variant and keeping the cheapest.
pub fn header_cost(ll: &[u8], d: &[u8]) -> u64 { todo!() }

/// Phase 4: adjust lengths to minimize header + data bits together.
/// Local search: try lengthening rare codes when that shortens the header.
pub fn tune_jointly(ll_freq: &[u32], d_freq: &[u32]) -> (Vec<u8>, Vec<u8>) { todo!() }
```

### 5.4 `match_finder.rs` — finding repeats (Phase 2 → 5)

```rust
//! For each position, list the candidate matches (len, dist), sorted by length,
//! with only the closest distance kept for each length. The parser uses all of them.

pub struct Match { pub len: u16, pub dist: u16 }

pub trait MatchFinder: Sync {
    /// All useful matches starting at `pos` (only data before `pos` is referenced).
    fn matches_at(&self, data: &[u8], pos: usize, out: &mut Vec<Match>);
}

/// Phase 2: hash of 3 bytes → chain of earlier positions. Simple and correct.
pub struct HashChain { head: Vec<u32>, prev: Vec<u32>, max_chain: u32 }

/// Phase 5: binary tree per hash bucket (as in LZMA's BT4). Returns every
/// longest-at-its-distance match with no long chain walks.
pub struct BinaryTree { /* left/right child arrays, 32 KB window */ }

pub fn build(data: &[u8], kind: crate::MatchFinderKind) -> Box<dyn MatchFinder> { todo!() }
```

Note on caching: the parser asks for the same positions on every pass, so `scheduler` precomputes a **match cache** (`Vec<SmallVec<Match>>`) once per block, sized by Options.

### 5.5 `cost_model.rs` — bit prices (Phase 3)

```rust
//! Estimated bits per symbol. The first pass uses a fixed-Huffman estimate;
//! later passes use the code lengths from the previous parse.

pub struct CostModel { lit_len: [f32; 286], dist: [f32; 30] }

impl CostModel {
    pub fn fixed() -> Self { todo!() }
    pub fn from_symbols(syms: &[crate::symbols::Symbol]) -> Self { todo!() }
    #[inline] pub fn literal(&self, b: u8) -> f32 { self.lit_len[b as usize] }
    /// Includes extra bits for length and distance.
    #[inline] pub fn matched(&self, len: u16, dist: u16) -> f32 { todo!() }
}
```

### 5.6 `parser.rs` — choosing literals vs. matches (Phase 2 → 3)

```rust
//! Turns a byte range into Symbols.
//!   greedy()   Phase 2: take the longest match; correct baseline.
//!   optimal()  Phase 3: shortest path over positions [start, end],
//!              edge cost = CostModel price. O(n × matches_per_pos).

use crate::{cost_model::CostModel, match_finder::Match, symbols::Symbol};

pub fn greedy(data: &[u8], start: usize, end: usize, cache: &[Vec<Match>]) -> Vec<Symbol> { todo!() }

pub fn optimal(
    data: &[u8], start: usize, end: usize,
    cache: &[Vec<Match>], costs: &CostModel,
) -> Vec<Symbol> {
    // dp[i] = cheapest bits to encode data[start..start+i]
    // for each i: relax literal edge (i → i+1) and every match length
    //             3..=m.len for each cached match (i → i+len)
    // trace back from dp[end-start] to produce symbols
    todo!()
}

/// Iterate: parse → re-estimate costs → parse, until no gain or max passes.
pub fn iterate(
    data: &[u8], start: usize, end: usize, cache: &[Vec<Match>], opts: &crate::Options,
) -> Vec<Symbol> {
    // keep best result by *actual* encoded size (block::dynamic_size), not estimate
    todo!()
}
```

### 5.7 `splitter.rs` — block boundaries (Phase 3 → 4)

```rust
//! Decides where Deflate blocks start and end. Each block gets its own Huffman
//! tables, so splitting pays off when the statistics change mid-file.
//!   Greedy (P3): Zopfli-style recursive best single split.
//!   DP (P4): candidate points from a quick greedy parse (statistics change);
//!            dp[j] = min over i<j of dp[i] + cost(block i..j);
//!            cost includes header bits. Up to `max_split_candidates`.

use std::ops::Range;

pub fn split(
    data: &[u8], mf: &dyn crate::match_finder::MatchFinder, opts: &crate::Options,
) -> Vec<Range<usize>> { todo!() }
```

### 5.8 `block.rs` — writing one block (Phases 2, 4)

```rust
//! Writes the cheapest of: stored (≤65,535-byte chunks), fixed Huffman, dynamic Huffman.

pub struct ParsedBlock { pub range: std::ops::Range<usize>, pub symbols: Vec<crate::symbols::Symbol> }

pub fn stored_size(len: usize) -> u64 { todo!() }
pub fn fixed_size(pb: &ParsedBlock) -> u64 { todo!() }
pub fn dynamic_size(pb: &ParsedBlock) -> u64 { todo!() }

pub fn write_best(out: &mut crate::bitwriter::BitWriter, data: &[u8], pb: &ParsedBlock, last: bool) { todo!() }
```

### 5.9 `scheduler.rs` — parallel and deterministic (Phase 5)

```rust
//! Parses blocks in parallel. This is safe because Deflate matches refer to the
//! ORIGINAL input (up to 32 KB back), not to earlier compressed output, so each
//! block can be parsed independently once the boundaries are fixed.
//! Determinism: results are collected in block order; no shared random state
//! (any random perturbation is seeded from block index).

use rayon::prelude::*;

pub fn parse_blocks(
    data: &[u8], mf: &dyn crate::match_finder::MatchFinder,
    blocks: &[std::ops::Range<usize>], opts: &crate::Options,
) -> Vec<crate::block::ParsedBlock> {
    blocks.par_iter()
        .map(|r| {
            let cache = todo!("precompute matches for r");
            let symbols = crate::parser::iterate(data, r.start, r.end, &cache, opts);
            crate::block::ParsedBlock { range: r.clone(), symbols }
        })
        .collect() // rayon keeps input order
}
```

---

## 6. `xdc-pack` — the container

### 6.1 `backend.rs`

```rust
//! Swappable Deflate encoders. Phase 1 ships Zopfli/libdeflate so the packer
//! is useful before our own encoder exists; Phase 2+ adds OwnBackend.

pub trait Backend: Sync {
    fn name(&self) -> &'static str;
    /// Raw Deflate stream for `data`.
    fn deflate(&self, data: &[u8]) -> Vec<u8>;
}

pub struct OwnBackend(pub deflate_opt::Options);
#[cfg(feature = "zopfli")]     pub struct ZopfliBackend { pub iterations: u32 }
#[cfg(feature = "libdeflate")] pub struct LibdeflateBackend { pub level: i32 }
```

### 6.2 `preprocess.rs`

```rust
//! Sorts each file into a class and picks the ZIP method:
//!   Media (png/jpg/webp/gif/zip/woff2) → try Deflate; store if gain < `min_gain`.
//!   Text/other → best of the configured backends.
//! Also produces a report: sizes, SHA-256 of vendor files (data for Track E),
//! and hints such as "N small JS files: bundling may save ~X bytes".

pub enum Method { Stored, Deflate(Vec<u8>) }

pub struct FileReport { pub path: String, pub raw: u64, pub out: u64, pub method: &'static str, pub sha256: String }

pub fn choose(path: &str, data: &[u8], backends: &[&dyn crate::backend::Backend], min_gain: f32) -> Method { todo!() }
```

### 6.3 `zip_writer.rs`

```rust
//! Minimal, deterministic ZIP (PKWARE APPNOTE) writer.
//!   - entries sorted by path; forward slashes; no directory entries
//!   - DOS timestamp fixed to 1980-01-01 00:00
//!   - methods 0 (stored) and 8 (deflate) only; no ZIP64 (webxdc apps are small;
//!     error out above 4 GiB)
//!   - no extra fields, no comments → smallest headers

pub struct Entry { pub path: String, pub crc32: u32, pub raw_len: u32, pub method: crate::preprocess::Method }

pub fn write(entries: &[Entry]) -> Vec<u8> { todo!() }
```

### 6.4 `lib.rs`

```rust
//! pack_dir(): folder → .xdc bytes + report.
//! Steps: walk dir (skip *.xdc, build scripts, dotfiles) → validate manifest.toml
//!        → per-file choose() in parallel → zip_writer::write.

pub struct PackOptions { pub level: u8, pub backends: Vec<String>, pub exclude: Vec<String>, pub min_gain: f32 }

pub fn pack_dir(dir: &std::path::Path, opts: &PackOptions)
    -> anyhow::Result<(Vec<u8>, Vec<crate::preprocess::FileReport>)> { todo!() }
```

---

## 7. CLI (`xdc-squeeze`)

```
xdc-squeeze pack <DIR> -o app.xdc [--level 1..12] [--backend own|zopfli|libdeflate|best]
                                  [--exclude GLOB]... [--report report.json]
xdc-squeeze recompress in.xdc -o out.xdc [--level N]   # re-optimize an existing .xdc
xdc-squeeze verify app.xdc                              # decode with all decoders, check CRCs
xdc-squeeze analyze <DIR>                               # sizes, hints, vendor hashes; writes nothing
```

To use it in this repo, `iris-timesheet-xdc/build.sh` changes from
`zip -9 -q -r iris-timesheet.xdc …` to
`xdc-squeeze pack . -o iris-timesheet.xdc --exclude build.sh`.

---

## 8. Phase 0 — benchmark harness (`xdc-bench`)

```rust
//! Runs each external tool on each corpus file and appends rows to bench/results.csv
//! (columns listed in 02-testing-plan §5.2). Tools that are not installed are skipped
//! with a warning. Each run is timed 5 times and the median kept.

struct Tool { name: &'static str, cmd: fn(&Path, &Path) -> std::process::Command }

const TOOLS: &[Tool] = &[ /* zip -9, zopfli --i15, ect -9, libdeflate -12, 7z, advzip */ ];
```

---

## 9. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Subtle Deflate bugs make corrupt `.xdc` files | Decode with several decoders + fuzzing (`02` §4); `verify` runs after every `pack` by default |
| The optimal parser is slow on huge files | Match-finder caps from `Options`; the DP splitter limits candidates |
| Gains are too small to matter (≤1%) | Phase 0 data decides; Phase 1 alone (per-file choice + advzip-level output) may be enough |
| Output differs between machines | No floats in final decisions (compare exact bit sizes); seeded randomness; collection in block order |
| Most bytes are third-party libraries (pdf-lib = 57% of iris) | Report it, and feed the data to the Track E proposal |

---

## 10. First concrete steps

1. `cargo new --lib` the workspace; add `testdata/` with `iris-timesheet-xdc` files and SHA-256 manifest.
2. Build `xdc-bench`, run it, commit `bench/results.csv` (Phase 0).
3. Build `zip_writer` + `preprocess` + Zopfli backend → `xdc-squeeze pack` (Phase 1).
4. Switch `build.sh` over once integration test I1 passes.
5. Start `deflate-opt` Phase 2 with `bitwriter` → `symbols` → `huffman` (unit tests first).
