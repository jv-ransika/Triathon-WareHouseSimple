"use client";

import { useActionState, useRef, useState } from "react";
import { createApiKeyAction } from "../actions";

export default function CreateKeyForm() {
  const [state, action, pending] = useActionState(createApiKeyAction, undefined);
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="card space-y-3">
      <form
        ref={formRef}
        action={async (fd) => {
          setCopied(false);
          await action(fd);
          formRef.current?.reset();
        }}
        className="flex flex-wrap items-end gap-2"
      >
        <div className="flex-1 min-w-[200px]">
          <label className="label" htmlFor="key-name">New key name</label>
          <input className="input" id="key-name" name="name" placeholder="e.g. ERP integration" required maxLength={60} />
        </div>
        <button className="btn" disabled={pending}>{pending ? "Creating…" : "Create key"}</button>
      </form>
      {state?.error && <p className="error">{state.error}</p>}
      {state?.key && (
        <div className="rounded-md p-3 space-y-2" style={{ border: "1px solid var(--accent)" }}>
          <p className="text-sm font-medium">Copy your key now. It will not be shown again.</p>
          <div className="flex flex-wrap gap-2 items-center">
            <code className="mono break-all flex-1">{state.key}</code>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => navigator.clipboard.writeText(state.key!).then(() => setCopied(true))}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
