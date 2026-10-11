# 14: Render — template, fit budget, self-lint

**What to build:** The builder produces an ATS-safe one-page PDF (D20/D44/D69): ONE template (single column, standard headings, standard fonts, no tables/text-in-images), rendered by headless Chrome running in the worker container, stored via the storage module, downloaded via signed URL. The fit budget escalates exactly two rungs: (1) fit-or-flag live warning on overflow; (2) deterministic typographic shrink — font/leading/margins as CSS variables stepped within professional bounds (bounds = config rows). Nothing is ever cut or rewritten silently; locked-block text is never altered; the evidence-weighted trim suggestions (ladder step 3) are explicitly OUT of scope. Self-lint: the system runs its own parser on the generated PDF and reports a parseability score (dogfooding as QA). Write the D16 prior-art note (print-CSS template + headless-Chrome container config) BEFORE building.

**Blocked by:** 02 (worker container for Chrome), 03 (PDF storage), 13 (blocks to render).

**Status:** done

- [x] Prior-art note in docs/prior-art/ written first (print-CSS template choice + headless-Chrome-in-container config)
- [x] ONE ATS-safe template; deterministic HTML/CSS → headless-Chrome print → PDF in the worker
- [x] PDF stored via the storage module; download via short-lived signed URL
- [x] Fit budget: live overflow warning, then explicit deterministic typographic shrink within config bounds; step 3 (trim suggestions) absent by design
- [x] Self-lint: generated PDF re-parsed via the S1 parser, parseability score surfaced in the UI
- [x] A small set of real headless-Chrome render tests against a golden fixture resume (deliberately few — slowest tests in the suite); PDF parses above threshold
- [x] Deterministic rendering verified: same input → byte-identical (or visually identical) output across runs
