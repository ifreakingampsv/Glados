"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createTokenAction, revokeTokenAction } from "@/app/actions/tokens";

export function TokenCreator() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div style={{ margin: "1rem 0" }}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await createTokenAction(name);
            if (result.ok && result.token) {
              setCreated(result.token);
              setName("");
              router.refresh();
            }
          });
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="token name (e.g. antigravity)"
        />
        <button type="submit" disabled={pending || !name.trim()}>
          Create token
        </button>
      </form>
      {created && (
        <p style={{ background: "#f4f4e8", padding: "0.5rem" }}>
          Copy it NOW — shown only once: <code>{created}</code>
        </p>
      )}
    </div>
  );
}

export function TokenRevoke({ tokenId }: { tokenId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await revokeTokenAction(tokenId);
          router.refresh();
        })
      }
    >
      revoke
    </button>
  );
}
