import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { isClerkConfigured } from "@/lib/env";
import "./globals.css";

export const metadata = {
  title: "GLaDOS",
  description:
    "Job-prep ecosystem: evidenced skills, projects, target roles, and gap diagnosis.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const body = (
    // suppressHydrationWarning: browser extensions (e.g. Video Speed Controller's
    // `vsc-initialized`) mutate <body> attributes before React hydrates — the
    // mismatch is theirs, not ours; silencing it here covers only this element.
    <body suppressHydrationWarning>
      <div className="app-shell">{children}</div>
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
