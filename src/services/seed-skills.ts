import { db } from "@/lib/db";

// Curated canonical seed (D24). Parent rows double as the D27 taxonomy
// (react → frontend, postgresql → database).
const PARENTS = [
  "languages",
  "frontend",
  "backend",
  "database",
  "devops",
  "mobile",
  "tooling",
];

const CANONICAL: Array<[name: string, display: string, parent?: string]> = [
  ["javascript", "JavaScript", "languages"],
  ["typescript", "TypeScript", "languages"],
  ["python", "Python", "languages"],
  ["go", "Go", "languages"],
  ["rust", "Rust", "languages"],
  ["java", "Java", "languages"],
  ["c", "C", "languages"],
  ["c#", "C#", "languages"],
  ["cpp", "C++", "languages"],
  ["ruby", "Ruby", "languages"],
  ["php", "PHP", "languages"],
  ["swift", "Swift", "languages"],
  ["kotlin", "Kotlin", "languages"],
  ["scala", "Scala", "languages"],
  ["react", "React", "frontend"],
  ["nextjs", "Next.js", "frontend"],
  ["vue", "Vue", "frontend"],
  ["svelte", "Svelte", "frontend"],
  ["angular", "Angular", "frontend"],
  ["html", "HTML", "frontend"],
  ["css", "CSS", "frontend"],
  ["tailwindcss", "Tailwind CSS", "frontend"],
  ["nodejs", "Node.js", "backend"],
  ["express", "Express", "backend"],
  ["nestjs", "NestJS", "backend"],
  ["django", "Django", "backend"],
  ["flask", "Flask", "backend"],
  ["fastapi", "FastAPI", "backend"],
  ["spring", "Spring", "backend"],
  ["graphql", "GraphQL", "backend"],
  ["rest", "REST APIs", "backend"],
  ["postgresql", "PostgreSQL", "database"],
  ["mysql", "MySQL", "database"],
  ["mongodb", "MongoDB", "database"],
  ["redis", "Redis", "database"],
  ["docker", "Docker", "devops"],
  ["kubernetes", "Kubernetes", "devops"],
  ["terraform", "Terraform", "devops"],
  ["aws", "AWS", "devops"],
  ["gcp", "GCP", "devops"],
  ["azure", "Azure", "devops"],
  ["linux", "Linux", "devops"],
  ["reactnative", "React Native", "mobile"],
  ["flutter", "Flutter", "mobile"],
  ["git", "Git", "tooling"],
];

const ALIASES: Array<[alias: string, canonical: string]> = [
  ["js", "javascript"],
  ["ts", "typescript"],
  ["golang", "go"],
  ["py", "python"],
  ["node", "nodejs"],
  ["postgres", "postgresql"],
  ["k8s", "kubernetes"],
  ["next", "nextjs"],
  ["rn", "reactnative"],
];

export async function seedCanonicalSkills() {
  for (const parent of PARENTS) {
    await db.skill.upsert({
      where: { name: parent },
      update: { display: parent, status: "ACTIVE" },
      create: { name: parent, display: parent, status: "ACTIVE" },
    });
  }
  for (const [name, display, parent] of CANONICAL) {
    const existing = await db.skill.findUnique({ where: { name } });
    if (existing && existing.status === "ACTIVE") continue;
    if (existing && existing.status !== "ACTIVE") continue; // never resurrect user-owned rows
    await db.skill.create({
      data: {
        name,
        display,
        status: "ACTIVE",
        parentId: parent
          ? ((await db.skill.findUnique({ where: { name: parent } }))?.id ??
            null)
          : null,
      },
    });
  }
  for (const [alias, canonical] of ALIASES) {
    const target = await db.skill.findUnique({ where: { name: canonical } });
    if (!target) continue;
    await db.skillAlias.upsert({
      where: { alias },
      update: { skillId: target.id },
      create: { alias, skillId: target.id },
    });
  }
}
