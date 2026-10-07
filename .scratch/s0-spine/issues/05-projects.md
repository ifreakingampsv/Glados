# 05: Projects as first-class entities

**What to build:** Users create and edit projects (title, description, links) as
first-class spine entities — the anchor the future recruiter view JOINs against evidence
events. CRUD through service functions with UI.

**Blocked by:** 04.

**Status:** ready-for-agent

- [x] User creates a project with title/description/links and sees it in their project list
- [x] User edits and deletes their own projects; another user's projects are invisible and unmodifiable (user_id scoping)
- [x] Service-layer tests assert tenant isolation (no cross-user reads or writes)
