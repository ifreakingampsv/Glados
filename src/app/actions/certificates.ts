"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  extractCertificatePdfMetadata,
  proposeCertificateSkillMapping,
  retryCertificateVerification,
  submitCertificate,
  type ProposedCertificateMapping,
  type SubmitCertificateResult,
} from "@/services/certificates";

export async function proposeCertificateMappingAction(
  formData: FormData
): Promise<
  | {
      ok: true;
      mapping: ProposedCertificateMapping;
      pdfBytesBase64: string | null;
    }
  | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };

  try {
    const provider = String(formData.get("provider") ?? "").trim();
    const verifyUrl = String(formData.get("verifyUrl") ?? "").trim();
    const courseName = String(formData.get("courseName") ?? "").trim();
    const file = formData.get("pdfFile") as File | null;

    let pdfBytes: Buffer | undefined;
    let pdfBytesBase64: string | null = null;
    let resolvedCourseName = courseName;

    if (file && file.size > 0) {
      pdfBytes = Buffer.from(await file.arrayBuffer());
      pdfBytesBase64 = pdfBytes.toString("base64");
      const meta = await extractCertificatePdfMetadata(pdfBytes);
      if (!resolvedCourseName && meta.courseNameHint) {
        resolvedCourseName = meta.courseNameHint;
      }
    }

    const mapping = await proposeCertificateSkillMapping({
      userId: user.id,
      provider,
      verifyUrl,
      courseName: resolvedCourseName || "Professional Certificate",
      pdfBytes,
    });

    return {
      ok: true,
      mapping,
      pdfBytesBase64,
    };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Could not propose certificate mapping",
    };
  }
}

export async function submitCertificateAction(input: {
  provider: string;
  verifyUrl?: string;
  courseName: string;
  issuedOn?: string;
  confirmedSkillIds: string[];
  pdfBytesBase64?: string | null;
}): Promise<
  { ok: true; result: SubmitCertificateResult } | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };

  try {
    const pdfBytes = input.pdfBytesBase64
      ? Buffer.from(input.pdfBytesBase64, "base64")
      : undefined;

    const result = await submitCertificate({
      userId: user.id,
      provider: input.provider,
      verifyUrl: input.verifyUrl,
      courseName: input.courseName,
      issuedOn: input.issuedOn,
      confirmedSkills: input.confirmedSkillIds,
      pdfBytes,
    });

    revalidatePath("/profile");
    revalidatePath("/skills");
    revalidatePath("/how-levels-work");
    revalidatePath("/events");

    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error ? err.message : "Certificate submission failed",
    };
  }
}

export async function retryCertificateVerificationAction(
  certificateId: string
): Promise<
  { ok: true; result: SubmitCertificateResult } | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Not signed in" };

  try {
    const result = await retryCertificateVerification({
      userId: user.id,
      certificateId,
    });
    revalidatePath("/profile");
    revalidatePath("/skills");
    revalidatePath("/how-levels-work");
    revalidatePath("/events");
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      message:
        err instanceof Error
          ? err.message
          : "Certificate verification retry failed",
    };
  }
}
