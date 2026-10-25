# S1 — Imports, gap map, scanner, resume walkthrough

Preflight: see [README](README.md). Uses YOUR real resume PDF, a real job
description, and (optionally) your GitHub account.

## Free scanner (anonymous)

- [ ] **Do:** in a private window, open `/scanner`; paste a JD (optionally upload
      your resume); submit.
      **Expect:** fit % + top-3 gaps without signing in; the full list is behind
      join/redeem; repeat scans past the daily cap get rate-limited, not errors.

## Gap map (signed in)

- [ ] **Do:** sign in; open Gaps; paste/save a JD; run the scan; flip the
      resume-mode ↔ profile-mode toggle.
      **Expect:** fit % that drills into a per-skill gap list; every skill carries a
      provenance label (evidenced vs claimed); the mode explainer is visible; your
      mode choice is remembered on return.

## Resume import

- [ ] **Do:** upload your real resume PDF.
      **Expect:** parsed skills land as CLAIMS (labeled unvalidated), resume blocks
      and work-experience entries are created; nothing evidenced changes.
- [ ] **Do:** upload a slightly edited version of the same resume.
      **Expect:** a staged diff (same / updated / new / gone) that applies only after
      you accept it; evidenced skills were untouched.

## GitHub import

- [ ] **Do:** connect GitHub; review the repo list; import a couple of non-fork
      repos.
      **Expect:** non-fork active repos preselected, forks unchecked with the
      one-line explainer; imported repos become projects carrying extracted skills;
      a `repo_imported` evidence event per repo on the events page.

## Work experience

- [ ] **Do:** open a parsed work-experience entry; re-confirm it.
      **Expect:** a confirmation/refresh event is appended (keeps its evidence
      fresh); "promote to project" creates a project only when you click it.

## Resume builder

- [ ] **Do:** open Resume; edit blocks; lock one; create a JD-bound variant of
      another; deliberately overflow the page.
      **Expect:** locked text never gets rewritten; the variant is bound to that JD
      and chosen automatically when tailoring to it; overflow triggers a warning,
      then typographic shrink — never silent cuts; PDF download works.
- [ ] **Do:** check the self-lint result on the generated PDF.
      **Expect:** a parseability score from running our own parser on our own PDF.

## LinkedIn review

- [ ] **Do:** upload your LinkedIn data-export PDF (or paste its text) on the
      LinkedIn page.
      **Expect:** a recruiter-attractiveness review against your target roles with
      add/post/visibility advice.

## Admin economics

- [ ] **Do:** open Admin.
      **Expect:** actual spend by feature/day, config-driven projections, and a
      break-even price floor; evidence readouts below (divergence slot says "until
      S1.5" is now filled by S1.5 — see its walkthrough).
