# 04: Profile + target roles + preferences

**What to build:** The descriptive-facts half of the spine: an editable profile following
a field-dictionary / JSON-Resume-compatible shape, target roles (title + seniority) with
exactly one primary at a time, and typed key–value preferences whose semantics fill in as
features ship. All mutations through service functions.

**Blocked by:** 03.

**Status:** ready-for-agent

- [x] User edits profile fields; the shape stays JSON-Resume-compatible (documented dictionary)
- [x] User creates target roles; setting one primary demotes the previous primary atomically
- [x] User reads/writes preferences; unknown keys are rejected by the service layer
- [x] Service-layer tests cover the one-primary invariant and preference validation
