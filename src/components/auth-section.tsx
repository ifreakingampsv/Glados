import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/env";

export function AuthSection() {
  if (!isClerkConfigured()) {
    return (
      <span className="badge badge-warning">Dev mode (Clerk keys not set)</span>
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
