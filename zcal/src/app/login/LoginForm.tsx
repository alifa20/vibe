"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "error" | "success">("idle");
  const [message, setMessage] = useState("");

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!password.trim()) {
      setStatus("error");
      setMessage("Enter your passphrase.");
      return;
    }

    setStatus("submitting");
    setMessage("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setStatus("error");
        setMessage(data.message ?? "Could not sign you in.");
        return;
      }
      setStatus("success");
      setPassword("");
      router.replace("/admin");
      router.refresh();
    } catch {
      setStatus("error");
      setMessage("Could not reach the server. Is it still running?");
    }
  }

  return (
    <form className="card stack" onSubmit={handleSubmit} noValidate>
      {status === "error" ? (
        <Notice tone="error" title="Not signed in">
          {message}
        </Notice>
      ) : null}

      <Field
        id="password"
        label="Passphrase"
        error={status === "error" ? message : undefined}
      >
        {(props) => (
          <input
            {...props}
            className="input"
            type="password"
            name="password"
            autoComplete="current-password"
            autoFocus
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (status === "error") setStatus("idle");
            }}
          />
        )}
      </Field>

      <div className="row">
        <SubmitButton pending={status === "submitting"} pendingLabel="Signing in…">
          Sign in
        </SubmitButton>
        {status === "success" ? <span className="text-small text-muted">Signed in. Taking you through…</span> : null}
      </div>
    </form>
  );
}
