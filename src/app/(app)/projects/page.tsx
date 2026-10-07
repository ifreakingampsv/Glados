import { getSessionUser } from "@/lib/auth";
import { listProjects } from "@/services/projects";
import {
  createProjectAction,
  deleteProjectAction,
  updateProjectAction,
} from "@/app/actions/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const user = await getSessionUser();
  if (!user) {
    return <p>Sign-in unavailable in this environment (no Clerk keys).</p>;
  }
  const projects = await listProjects(user.id);

  return (
    <main>
      <h1>Projects</h1>
      <ul>
        {projects.map((p) => (
          <li key={p.id} style={{ marginBottom: "1rem" }}>
            <strong>{p.title}</strong>
            <p>{p.description}</p>
            <form
              action={updateProjectAction}
              style={{ display: "inline-flex", gap: "0.3rem" }}
            >
              <input type="hidden" name="projectId" value={p.id} />
              <input name="title" defaultValue={p.title} />
              <input name="description" defaultValue={p.description} />
              <button type="submit">Save</button>
            </form>{" "}
            <form action={deleteProjectAction} style={{ display: "inline" }}>
              <input type="hidden" name="projectId" value={p.id} />
              <button type="submit">Delete</button>
            </form>
          </li>
        ))}
      </ul>
      <form action={createProjectAction}>
        <input name="title" placeholder="Project title" required />
        <input name="description" placeholder="What it is" required />
        <button type="submit">Add project</button>
      </form>
    </main>
  );
}
