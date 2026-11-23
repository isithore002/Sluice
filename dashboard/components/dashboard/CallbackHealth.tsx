"use client";

import type { CallbackHealth } from "../../lib/useCallbackHealth";

const rejected = (h: CallbackHealth) => h.base === "rejected" || h.uni === "rejected";
const checking = (h: CallbackHealth) => h.checkedAt === null;

/** A small status chip for the header: are Reactive's callbacks being accepted by the destination proxies? Words plus an icon, never colour alone. */
export function CallbackBadge({ health }: { health: CallbackHealth }) {
  if (checking(health)) {
    return (
      <span className="sl-status warn" title="Asking the callback proxies whether they accept Reactive's signer">
        <span className="dot" aria-hidden="true" />
        checking Reactive callbacks…
      </span>
    );
  }
  if (rejected(health)) {
    return (
      <span className="sl-status bad" title="A callback proxy answers NotAuthorized() to Reactive's signer, so callbacks revert before reaching our vault">
        <span className="dot" aria-hidden="true" />! Reactive callbacks rejected
      </span>
    );
  }
  if (health.base === "accepted" && health.uni === "accepted") {
    return (
      <span className="sl-status good" title="Both callback proxies accept Reactive's signer">
        <span className="dot" aria-hidden="true" />✓ Reactive callbacks accepted
      </span>
    );
  }
  // At least one answer is missing (an RPC error or rate limit): say so, never imply the callbacks are fine.
  return (
    <span className="sl-status warn" title="The callback proxies could not be checked just now">
      <span className="dot" aria-hidden="true" />Reactive callback status unavailable
    </span>
  );
}

const name = { base: "Base Sepolia", uni: "Unichain Sepolia" } as const;

/** Shown above the live demo only when a proxy rejects Reactive's signer: says plainly why a live settlement won't complete, and what still holds. */
export function CallbackNotice({ health }: { health: CallbackHealth }) {
  if (!rejected(health)) return null;
  const which = (["base", "uni"] as const).filter((k) => health[k] === "rejected").map((k) => name[k]);
  return (
    <div className="sl-banner cb-notice" role="status">
      <b>Live settlement is paused by Reactive&apos;s relay, not by Sluice.</b> The {which.join(" and ")} callback {which.length > 1 ? "proxies answer" : "proxy answers"}{" "}
      <span className="sl-mono">NotAuthorized()</span> to Reactive&apos;s signer, so every callback reverts before it reaches
      our vault. Reactive still reacts on Lasna; the delivery fails at the destination. A repayment right now will not pay the queue until Reactive re-authorizes its
      signer. The recorded runs below are real transactions from when delivery worked.
    </div>
  );
}
