import { getSessionUser } from "@/lib/auth";
import {
  KNOWN_PREFERENCE_KEYS,
  PROFILE_SECTIONS,
  getPreferences,
  getProfile,
  listTargetRoles,
} from "@/services/profile";
import {
  addRoleAction,
  removeRoleAction,
  setPreferenceAction,
  setPrimaryAction,
  updateSectionAction,
} from "@/app/actions/profile";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await getSessionUser();
  if (!user) {
    return <p>Sign-in unavailable in this environment (no Clerk keys).</p>;
  }
  const [profile, roles, prefs] = await Promise.all([
    getProfile(user.id),
    listTargetRoles(user.id),
    getPreferences(user.id),
  ]);
  const fields = profile.fields as Record<string, unknown>;

  return (
    <main>
      <h1>Profile</h1>
      <section>
        <h2>Field dictionary (JSON-Resume compatible)</h2>
        <dl>
          {Object.entries(fields).map(([section, value]) => (
            <div key={section}>
              <dt>
                <strong>{section}</strong>
              </dt>
              <dd>
                <pre style={{ whiteSpace: "pre-wrap" }}>
                  {JSON.stringify(value, null, 2)}
                </pre>
              </dd>
            </div>
          ))}
        </dl>
        <form action={updateSectionAction}>
          <select name="section">
            {PROFILE_SECTIONS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <textarea name="value" placeholder='{"name": "…"}' rows={3} />
          <button type="submit">Save section</button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Target roles</h2>
        <ul>
          {roles.map((r) => (
            <li key={r.id}>
              {r.isPrimary ? "★ " : ""}
              {r.title}
              {r.seniority ? ` (${r.seniority})` : ""}{" "}
              {!r.isPrimary && (
                <form action={setPrimaryAction} style={{ display: "inline" }}>
                  <input type="hidden" name="roleId" value={r.id} />
                  <button type="submit">make primary</button>
                </form>
              )}{" "}
              <form action={removeRoleAction} style={{ display: "inline" }}>
                <input type="hidden" name="roleId" value={r.id} />
                <button type="submit">remove</button>
              </form>
            </li>
          ))}
        </ul>
        <form action={addRoleAction}>
          <input name="title" placeholder="Backend Engineer" required />
          <input name="seniority" placeholder="Junior (optional)" />
          <button type="submit">Add role</button>
        </form>
      </section>

      <section style={{ marginTop: "2rem" }}>
        <h2>Preferences</h2>
        <ul>
          {prefs.map((p) => (
            <li key={p.id}>
              {p.key} = {p.value}
            </li>
          ))}
        </ul>
        <form action={setPreferenceAction}>
          <select name="key">
            {KNOWN_PREFERENCE_KEYS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <input name="value" placeholder="value" required />
          <button type="submit">Save preference</button>
        </form>
      </section>
    </main>
  );
}
