# 08: Profile write-back + work experience as evidence

**What to build:** Creating a profile from a parsed resume seeds the spine (D55 case 2): skills enter as CLAIMS (visibly unvalidated), content becomes resume blocks, and experience becomes structured `work_experiences` rows (employer, title, period, kind job|internship, description, skills[]) that EARN EVIDENCE — points scaled by duration × specificity via a DETERMINISTIC scorer (named-stack mentions × description depth; params = config rows — stable across re-parses, auditable; D56/D71). Events are attestation-dated (when imported), decay stays uniform (D24), and users can re-confirm an experience to append a refresh event. Users can set self-assessed levels for zero-evidence skills (permanent tier — fills holes, never enters the evidenced score) and promote an experience entry to a project with one click (D55b: the project bank stays user-curated).

**Blocked by:** 05 (event types + points config), 07 (parse output).

**Status:** done

- [x] Profile-creation flow: parse result → claims + resume_blocks + work_experiences in one transaction
- [x] `resume_imported` audit event appended; `work_experience_added` evidence events with attestation-dated occurred_at and duration × specificity points (scorer params config-driven)
- [x] Deterministic specificity scorer implemented + unit-tested (auditable, re-parse-stable)
- [x] Re-confirm action appends `work_experience_confirmed` refresh event
- [x] Self-assessment tier: user-set levels display "self-assessed", fill zero-evidence holes, never touch the evidenced score
- [x] One-click promote-to-project from an experience entry
- [x] Unvalidated claims visibly labeled with explainer links (D62 micro-teaching); evidence-based surfaces exclude them
- [x] `resume_blocks` table created here (S0-deferred per D37a; source_ref may FK projects or work_experiences per D56)
- [x] Service tests for all of the above incl. tenant scoping
