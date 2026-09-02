"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { SubmitButton } from "./SubmitButton";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  return (
    <SubmitButton
      type="button"
      className="btn btn--ghost btn--sm"
      pending={pending}
      pendingLabel="Signing out…"
      onClick={async () => {
        setPending(true);
        await fetch("/api/auth/logout", { method: "POST" });
        router.replace("/login");
        router.refresh();
      }}
    >
      Sign out
    </SubmitButton>
  );
}
