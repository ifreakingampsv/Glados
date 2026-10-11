"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { reviewLinkedinProfile } from "@/services/linkedin-review";

export async function runLinkedinReviewAction(formData: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/");

  const targetRoles = String(formData.get("targetRoles") ?? "").trim();
  const rawText = String(formData.get("rawText") ?? "").trim();
  const file = formData.get("pdfFile") as File | null;

  let pdfBytes: Buffer | undefined;
  if (file && file.size > 0) {
    pdfBytes = Buffer.from(await file.arrayBuffer());
  }

  try {
    const result = await reviewLinkedinProfile({
      userId: user.id,
      targetRoles: targetRoles || "Software Engineer",
      pdfBytes,
      rawText: rawText || undefined,
    });
    const encoded = Buffer.from(JSON.stringify(result), "utf8").toString(
      "base64url"
    );
    redirect(`/linkedin?result=${encoded}`);
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err) {
      throw err;
    }
    const msg = err instanceof Error ? err.message : "LinkedIn review failed.";
    redirect(`/linkedin?error=${encodeURIComponent(msg)}`);
  }
}
