import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listProjects } from "@/services/projects";
import {
  fetchPublicReposForClerkUser,
  getGithubImportCap,
  prepareRepoSelectionList,
} from "@/services/github-import";
import {
  createProjectAction,
  deleteProjectAction,
  removeProjectSkillAction,
  updateProjectAction,
} from "@/app/actions/projects";
import { ProjectSkillEditor } from "@/components/project-skill-editor";
import { GithubImportPanel } from "@/components/github-import-panel";

export const dynamic = "force-dynamic";

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ error?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) {
    return (
      <main className="section-card">
        <p className="empty-state">
          Sign-in unavailable in this environment (no Clerk keys configured).
        </p>
      </main>
    );
  }
  const params = searchParams ? await searchParams : {};
  const [projects, githubData, importCap] = await Promise.all([
    listProjects(user.id),
    fetchPublicReposForClerkUser(user.clerkId),
    getGithubImportCap(),
  ]);
  const { items: repoItems, forkExplainer } = prepareRepoSelectionList(
    githubData.repos
  );
  const allSkillIds = Array.from(
    new Set(projects.flatMap((p) => p.skills ?? []))
  );
  const skillRows = allSkillIds.length
    ? await db.skill.findMany({ where: { id: { in: allSkillIds } } })
    : [];
  const skillDisplayById = new Map(skillRows.map((s) => [s.id, s.display]));

  return (
    <main>
      <h1>Projects</h1>
      <p className="lede">
        Your curated bank of shipped projects and repositories. Tag the skills
        each project demonstrates so profile-mode gap matching can verify them.
      </p>

      {params.error === "invalid" && (
        <div className="alert alert-danger" role="alert">
          Project title and description are both required.
        </div>
      )}

      <GithubImportPanel
        connected={githubData.connected}
        items={repoItems}
        forkExplainer={forkExplainer}
        cap={importCap}
      />

      <section className="section-card">
        <h2>Add project</h2>
        <form action={createProjectAction} className="row">
          <input name="title" placeholder="Project title" required />
          <input
            name="description"
            placeholder="What it is and how it works"
            required
          />
          <button type="submit" className="btn btn-primary">
            Add project
          </button>
        </form>
      </section>

      <section className="section-card">
        <h2>Your project bank ({projects.length})</h2>
        {projects.length === 0 ? (
          <p className="empty-state">
            No projects in your bank yet. Add one above to start tracking
            project-backed evidence.
          </p>
        ) : (
          <ul className="item-list">
            {projects.map((p) => (
              <li key={p.id} className="item-row stack">
                <div>
                  <strong>{p.title}</strong>
                  <p className="muted" style={{ marginTop: "0.25rem" }}>
                    {p.description}
                  </p>
                </div>

                <div className="row">
                  {(p.skills ?? []).length === 0 ? (
                    <span className="muted">No skills attached yet.</span>
                  ) : (
                    (p.skills ?? []).map((skillId) => (
                      <form
                        key={skillId}
                        action={removeProjectSkillAction}
                        className="row"
                      >
                        <input type="hidden" name="projectId" value={p.id} />
                        <input type="hidden" name="skillId" value={skillId} />
                        <span className="badge badge-accent">
                          {skillDisplayById.get(skillId) ?? skillId}
                        </span>
                        <button
                          type="submit"
                          className="btn btn-sm"
                          aria-label={`Remove skill ${skillDisplayById.get(skillId) ?? skillId}`}
                        >
                          Remove
                        </button>
                      </form>
                    ))
                  )}
                </div>

                <ProjectSkillEditor projectId={p.id} />

                <div className="row">
                  <form action={updateProjectAction} className="row">
                    <input type="hidden" name="projectId" value={p.id} />
                    <input
                      name="title"
                      defaultValue={p.title}
                      aria-label="Project title"
                    />
                    <input
                      name="description"
                      defaultValue={p.description}
                      aria-label="Project description"
                    />
                    <button type="submit" className="btn btn-sm">
                      Save
                    </button>
                  </form>
                  <form action={deleteProjectAction}>
                    <input type="hidden" name="projectId" value={p.id} />
                    <button type="submit" className="btn btn-sm btn-danger">
                      Delete
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
