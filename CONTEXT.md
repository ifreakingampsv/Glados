# GLaDOS — Domain Language

Glossary for the GLaDOS job-prep ecosystem: one shared user "spine" that feature
slices read and write. Decisions live in `docs/DECISIONS.md`; this file records the
vocabulary, not the implementation.

## Spine & identity

**Spine**:
The shared per-user core — profile, evidenced skills, projects, target role,
preferences, event log — that every feature slice reads and writes.
_Avoid_: "profile" when you mean the whole spine.

**Target role**:
The job a user is aiming at; gap-map framing and recommendations anchor to it.

**Cohort**:
An optional named group of users with an owner; the seed of a future campus mode.
_Avoid_: org, team.

**Source**:
The channel an action entered the system through (web, agent_plugin, extension,
system) — derived from how the request authenticated, never client-declared; drives
trust weighting of evidence.

**Invite code**:
A single-use code that redeems a waitlist signup; app access gates on redemption.

## Skills & evidence

**Canonical skill**:
The single approved vocabulary entry for a capability.
_Avoid_: skill tag.

**Alias**:
Text that resolves to a canonical skill.

**Candidate skill**:
A typed skill awaiting promotion (approve / merge / reject).

**Claimed level**:
A user's self-rated ability for a skill; never contributes to the evidenced score.

**Evidence event**:
One immutable log row: who, what type, which skills, signed points, when, source.
_Avoid_: activity, history entry.

**Evidenced level**:
The L0–L5 band over a skill's decayed evidence score.
_Avoid_: "skill level" (ambiguous with claimed level).

**user_skills**:
The materialized per-user, per-skill current score and level, rebuilt from the log.

**Retired skill**:
A skill no longer offered for new tagging but kept because evidence events reference
it; a merge leaves a pointer to the absorbing canonical skill.

**Gap map**:
Required-vs-have skill comparison for a JD, computed as a canonical-id set
difference.

## AI & quota

**Gateway**:
The single path through which platform AI money is spent and trusted judgments
enter the spine.

**Platform fallback**:
Explicit per-incident user consent to run a failed BYO call on the platform route —
metered and capped like any platform call; never silent.

**Energy bar**:
One unit of platform-paid AI allowance for heavy features, denominated in
worst-case dollars.

**Attractor feature**:
A free AI feature with a fixed daily cap, used to draw users in.
_Avoid_: free tool.

**Weekly briefing**:
A periodic personal progress report generated over the event log.

## Resume

**Resume block**:
One unit of resume content; originals and variants share one table.

**Original**:
A resume block with no parent.

**Variant**:
A JD-bound derived copy of an original.

**Locked block**:
A block whose text the user froze; never silently rewritten.

**Fit budget**:
The roughly one-page content limit the resume builder enforces ("fit or flag").
