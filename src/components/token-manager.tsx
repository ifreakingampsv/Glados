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
    <div className="stack">
      <form
        className="row"
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
          placeholder="Token name (e.g. antigravity)"
          aria-label="Token name"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !name.trim()}
        >
          {pending ? "Minting..." : "Create token"}
        </button>
      </form>
      {created && (
        <div className="alert alert-warning" role="status">
          Copy this token now (shown only once): <code>{created}</code>
        </div>
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
      className="btn btn-sm btn-danger"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await revokeTokenAction(tokenId);
          router.refresh();
        })
      }
    >
      {pending ? "Revoking..." : "Revoke"}
    </button>
  );
}
