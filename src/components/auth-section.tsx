import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/env";

export function AuthSection() {
  if (!isClerkConfigured()) {
    return (
      <p style={{ color: "#a66" }}>
        Clerk keys missing — set NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and
        CLERK_SECRET_KEY in .env to enable sign-in (T02).
      </p>
    );
  }
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal" />
      </SignedOut>
      <SignedIn>
        <UserButton />
      </SignedIn>
    </>
  );
}
