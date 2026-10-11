"use server";

import crypto from "node:crypto";
import { cookies, headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import {
  claimAnonymousScanOnSignup,
  runPublicOrFreeScan,
  type ScannerResult,
} from "@/services/scanner";

export const ANON_SCAN_COOKIE = "glados_anon_scan";

export async function runScannerAction(
  jdText: string,
  resumeText: string
): Promise<{ ok: boolean; result?: ScannerResult; message?: string }> {
  try {
    const user = await getSessionUser();
    const hdrs = await headers();
    const cookieStore = await cookies();

    const forwardedFor = hdrs.get("x-forwarded-for");
    const rawIp = forwardedFor
      ? forwardedFor.split(",")[0].trim()
      : (hdrs.get("x-real-ip") ?? "127.0.0.1");

    let sessionToken = cookieStore.get(ANON_SCAN_COOKIE)?.value;
    if (!sessionToken) {
      sessionToken = `anon_${crypto.randomBytes(16).toString("hex")}`;
      cookieStore.set(ANON_SCAN_COOKIE, sessionToken, {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 86_400,
      });
    }

    const result = await runPublicOrFreeScan({
      userId: user?.id ?? null,
      rawIp,
      sessionToken,
      jdText,
      resumeText: resumeText.trim() || undefined,
    });

    revalidatePath("/scanner");
    revalidatePath("/gaps");
    return { ok: true, result };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Scan failed",
    };
  }
}

export async function claimCookieScanAction(): Promise<{
  claimed: boolean;
  jdId?: string;
}> {
  const user = await getSessionUser();
  if (!user) return { claimed: false };
  const cookieStore = await cookies();
  const token = cookieStore.get(ANON_SCAN_COOKIE)?.value;
  if (!token) return { claimed: false };

  const res = await claimAnonymousScanOnSignup(user.id, token);
  if (res.claimed) {
    cookieStore.delete(ANON_SCAN_COOKIE);
    revalidatePath("/gaps");
    revalidatePath("/scanner");
  }
  return { claimed: res.claimed, jdId: res.jdId };
}
