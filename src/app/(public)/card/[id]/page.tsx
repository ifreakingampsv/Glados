import { notFound } from "next/navigation";
import { db } from "@/lib/db";

// D82 shareable readiness card: public, unbranded (no product wordmark — the
// OQ7 rename checklist fires before anything branded goes public), band +
// dimensions ONLY — never transcript content. Deterministic render from
// report data (no AI at render time). Flag must EXIST and be enabled;
// absence = disabled.
export const dynamic = "force-dynamic";

const DIMENSION_LABELS: Array<[string, string]> = [
  ["techDepth", "Technical depth"],
  ["problemSolving", "Problem solving"],
  ["tradeoffs", "Tradeoffs"],
  ["communication", "Communication"],
  ["composure", "Composure"],
];

export default async function ReadinessCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const flag = await db.featureFlag.findUnique({
    where: { key: "interview.shareCard" },
  });
  if (!flag?.enabled) notFound();

  const session = await db.interviewSession.findUnique({
    where: { id },
    include: { reports: true },
  });
  const report = session?.reports[0];
  if (!session || !report || report.techDepth === null) notFound();

  const profile = await db.profile.findUnique({
    where: { userId: session.userId },
  });
  const name =
    ((profile?.fields as { name?: string } | null)?.name ?? "").trim() ||
    "A candidate";

  return (
    <main className="section-card">
      <h1>
        {name} · Interview readiness: {report.readinessBand}
      </h1>
      <p>
        Startup-mode project interview, graded on five dimensions (1–4 each).
      </p>
      <ul>
        {DIMENSION_LABELS.map(([key, label]) => (
          <li key={key}>
            {label}: {report[key as "techDepth"] ?? "–"}/4
          </li>
        ))}
      </ul>
      <p>
        <small>
          Graded{" "}
          {report.evidenceBasis === "records"
            ? "against decision records"
            : "on reasoning quality"}
          .
        </small>
      </p>
    </main>
  );
}
