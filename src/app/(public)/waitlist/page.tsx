import Link from "next/link";
import { getSessionUser } from "@/lib/auth";
import { isGateOpen } from "@/services/waitlist";
import { redeemCodeAction } from "@/app/actions/waitlist";

export const dynamic = "force-dynamic";

export default async function WaitlistPage({
  searchParams,
}: {
  searchParams: Promise<{ joined?: string; error?: string }>;
}) {
  const params = await searchParams;
  const user = await getSessionUser();

  if (user && isGateOpen(user)) {
    return (
      <main>
        <p>You&apos;re in.</p>
        <Link href="/profile">Go to your spine →</Link>
      </main>
    );
  }

  return (
    <main>
      <h1>Waitlist</h1>
      {params.joined && (
        <p>You&apos;re on the list — we&apos;ll email your invite code.</p>
      )}
      {params.error === "bad-code" && (
        <p style={{ color: "#a33" }}>Invalid or already-used code.</p>
      )}
      {!user && <p>Sign in first, then redeem your invite code below.</p>}
      <form action={redeemCodeAction}>
        <input name="code" placeholder="invite code" required />
        <button type="submit">Redeem</button>
      </form>
    </main>
  );
}
