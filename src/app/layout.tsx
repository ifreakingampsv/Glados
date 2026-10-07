import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/env";

export const metadata = {
  title: "GLaDOS",
  description: "Job-prep ecosystem — spine slice",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const body = (
    // suppressHydrationWarning: browser extensions (e.g. Video Speed Controller's
    // `vsc-initialized`) mutate <body> attributes before React hydrates — the
    // mismatch is theirs, not ours; silencing it here covers only this element.
    <body
      suppressHydrationWarning
      style={{ fontFamily: "system-ui, sans-serif", margin: "2rem" }}
    >
      {children}
    </body>
  );
  return isClerkConfigured() ? (
    <html lang="en">
      <ClerkProvider>{body}</ClerkProvider>
    </html>
  ) : (
    <html lang="en">{body}</html>
  );
}
