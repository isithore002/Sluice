"use client";

import type { ReactNode } from "react";
import { short } from "../dashboard/format";
import { txUrl } from "../../lib/config";

export type StepState = "todo" | "active" | "busy" | "done" | "error";

interface Props {
  n: number;
  title: string;
  /** One plain sentence on what this transaction does and why. */
  hint: ReactNode;
  state: StepState;
  /** The real transaction behind this step, once sent. */
  tx?: string | null;
  /** The button label while the step is the next one to do. */
  action: string;
  busyLabel?: string;
  onAction: () => void;
  /** Extra controls (an amount field, a note) shown under the hint. */
  children?: ReactNode;
  error?: string | null;
}

const STATE_WORDS: Record<StepState, string> = {
  todo: "not available yet",
  active: "your next step",
  busy: "in progress",
  done: "done",
  error: "failed, try again",
};

/** One numbered, real transaction in a role's walkthrough. */
export function StepRow({ n, title, hint, state, tx, action, busyLabel, onAction, children, error }: Props) {
  const isNext = state === "active" || state === "error";
  return (
    <li className={`dm-step ${state}`} aria-current={isNext || state === "busy" ? "step" : undefined} aria-busy={state === "busy" || undefined}>
      <span className="dm-num" aria-hidden="true">
        {state === "done" ? "✓" : n}
      </span>
      <div className="dm-body">
        {isNext && (
          <span className="dm-next" aria-hidden="true">
            {state === "error" ? "Try again" : "Your next step"}
          </span>
        )}
        <p className="dm-title">
          {title}
          <span className="sr-only">
            {" "}
            (step {n}: {STATE_WORDS[state]})
          </span>
        </p>
        <p className="dm-hint">{hint}</p>
        {children}
        {error && state === "error" && (
          <p className="sl-err" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="dm-act">
        {state === "done" ? (
          tx ? (
            <a className="sl-link sl-mono" href={txUrl("base", tx)} target="_blank" rel="noreferrer" aria-label={`Step ${n} transaction ${short(tx, 6, 4)} on the block explorer`}>
              {short(tx, 6, 4)} ↗
            </a>
          ) : (
            <span className="dm-ok">done</span>
          )
        ) : (
          <button className={`sl-btn small${isNext ? " primary" : ""}`} onClick={onAction} disabled={state === "todo" || state === "busy"}>
            {state === "busy" ? (busyLabel ?? "Working…") : state === "error" ? "Try again" : action}
          </button>
        )}
      </div>
    </li>
  );
}
