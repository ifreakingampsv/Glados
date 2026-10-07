# 11: Agent API tokens + source derivation

**What to build:** Users create/revocable API tokens for their coding agents per [D35]:
SHA-256-hashed at rest, shown once at creation, prefix-based lookup (GitHub-PAT pattern),
full-user scope. `source` is DERIVED from the auth channel, never client input: cookie →
web; token → client may declare agent_plugin | extension; server → system. web/system are
unreachable from tokens.

**Blocked by:** 02.

**Status:** ready-for-agent

- [x] Token created → full value shown exactly once; lookup works by prefix; hash stored, not the token
- [x] Token-authenticated request reaches services as the owning user
- [x] Token requests may declare agent_plugin/extension; declaring web or system is refused/ignored
- [x] Revoked tokens stop working immediately
- [x] Service-layer tests cover channel derivation and revocation
