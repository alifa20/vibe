"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Field } from "@/components/Field";
import { Notice } from "@/components/Notice";
import { SubmitButton } from "@/components/SubmitButton";

export function CancelForm({
  publicId,
  token,
  bookingSlug,
}: {
  publicId: string;
  token: string;
  bookingSlug: string | null;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/bookings/${encodeURIComponent(publicId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, reason: reason.trim() }),
      });
      const data = (await response.json()) as { message?: string };
      if (!response.ok) {
        setError(data.message ?? "That did not work. The booking is unchanged.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Could not reach the server. Nothing has been cancelled — try again.");
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className="stack">
        <Notice tone="success" title="Cancelled">
          The booking is cancelled and the time has been released.
        </Notice>
        {bookingSlug ? (
          <div>
            <Link className="btn" href={`/book/${bookingSlug}`}>
              Book a different time
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <form className="card stack" onSubmit={cancel} noValidate>
      {error ? (
        <Notice tone="error" title="Not cancelled">
          {error}
        </Notice>
      ) : null}

      <Field
        id="cancel-reason"
        label="Why are you cancelling?"
        hint="Optional. Stored with the booking on the owner's machine."
      >
        {(props) => (
          <textarea
            {...props}
            className="textarea"
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </Field>

      <div className="row">
        <SubmitButton className="btn btn--danger" pending={pending} pendingLabel="Cancelling…">
          Cancel this booking
        </SubmitButton>
        {bookingSlug ? (
          <Link className="btn btn--ghost" href={`/book/${bookingSlug}`}>
            Keep it, take me back
          </Link>
        ) : null}
      </div>
    </form>
  );
}
