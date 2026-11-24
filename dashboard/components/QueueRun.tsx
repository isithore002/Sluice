"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BatchResult } from "../lib/manifest";

/** Seconds, to two decimals, for the clock and the markers. */
const sec = (ms: number) => (ms / 1000).toFixed(2);

/** Gap between two tickets inside one callback, so a batch reads as a sweep rather than a flash. */
const SWEEP_MS = 14;

type Phase = "idle" | "running" | "done";

/**
 * The hero's recorded run: N lenders queued for cash that was fully borrowed out, then ONE repayment on Morpho paid all of them,
 * in order, through two callbacks. It replays the measured run (results/batch-*.json) at real speed: tickets turn brass at the
 * moment each callback landed on Base. Nothing here is simulated: the timings and transaction links are the recorded ones.
 */
export function QueueRun({ batch }: { batch: BatchResult }) {
  const n = batch.n;
  const cbs = batch.callbacks;
  const firstMs = batch.timing.repayToFirstBatchMs ?? 0;
  const emptyMs = batch.timing.repayToQueueEmptyMs;

  // When each ticket was paid, in ms after the repayment: its callback's landing time plus its place in the sweep.
  const paidAt = useRef<number[]>([]);
  const owner = useRef<number[]>([]);
  if (paidAt.current.length !== n) {
    let i = 0;
    const times = [firstMs, emptyMs];
    cbs.forEach((cb, k) => {
      for (let j = 0; j < cb.payments && i < n; j++, i++) {
        paidAt.current[i] = (times[k] ?? emptyMs) + j * SWEEP_MS;
        owner.current[i] = k;
      }
    });
    for (; i < n; i++) {
      paidAt.current[i] = emptyMs;
      owner.current[i] = cbs.length - 1;
    }
  }

  const [t, setT] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");
  const [reduce, setReduce] = useState(false);
  const raf = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const finalMs = (paidAt.current[n - 1] ?? emptyMs) + 80;

  const play = useCallback(() => {
    cancelAnimationFrame(raf.current);
    setPhase("running");
    const t0 = performance.now();
    let lastSet = -1e9;
    const step = (now: number) => {
      const ms = now - t0;
      if (now - lastSet >= 32 || ms >= finalMs + 250) {
        lastSet = now;
        setT(ms); // about 30 renders a second, not one per frame: the grid has 40 tiles
      }
      if (ms < finalMs + 250) raf.current = requestAnimationFrame(step);
      else setPhase("done");
    };
    raf.current = requestAnimationFrame(step);
  }, [finalMs]);

  useEffect(() => {
    const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduce(rm);
    if (rm) {
      setT(finalMs + 500);
      setPhase("done");
      return;
    }
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !started.current) {
          started.current = true;
          window.setTimeout(play, 600);
        }
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf.current);
    };
  }, [play, finalMs]);

  const paid = paidAt.current.filter((ms) => t >= ms).length;
  const cb1Done = t >= firstMs && phase !== "idle";
  const status =
    phase === "idle"
      ? `${n} withdrawals are queued. The market is fully borrowed, so there is no cash to pay them.`
      : paid >= n
        ? `Queue empty ${sec(emptyMs)} s after the repayment. All ${n} were paid in order.`
        : cb1Done
          ? `Callback 1 paid ${cbs[0]?.payments ?? 0} withdrawals. Reactive is already scheduling the next batch.`
          : "A borrower repays on Morpho. Reactive has seen it and is calling the vault.";

  const rows = Math.ceil(n / 10);

  return (
    <div ref={rootRef} className="qr" aria-label="Recorded run: one repayment pays a queue of withdrawals">
      <div className="qr-head">
        <div>
          <p className="qr-title">One repayment, {n} withdrawals</p>
          <p className="qr-sub">Replay of a recorded run on Base Sepolia, at real speed</p>
        </div>
        <output className="qr-clock" aria-hidden="true">
          {phase === "idle" ? "0.00" : sec(Math.min(t, finalMs))}
          <span> s</span>
        </output>
      </div>

      <ol className="qr-grid" style={{ ["--rows" as string]: rows }}>
        {Array.from({ length: n }, (_, i) => {
          const isPaid = t >= paidAt.current[i] && phase !== "idle";
          return (
            <li key={i} className="qr-cell" data-paid={isPaid ? owner.current[i] + 1 : undefined}>
              <span className="sr-only">{`Withdrawal ${i + 1}, ${isPaid ? "paid" : "waiting"}`}</span>
              <span aria-hidden="true">{i + 1}</span>
            </li>
          );
        })}
      </ol>

      <p className="qr-status" role="status" aria-live="polite">
        {status}
      </p>

      <dl className="qr-marks">
        <div>
          <dt>Repayment</dt>
          <dd>0.00 s</dd>
        </div>
        {cbs.map((cb, k) => (
          <div key={cb.tx}>
            <dt>
              <a className="sl-link" href={cb.link} target="_blank" rel="noreferrer">
                Callback {k + 1}
              </a>
            </dt>
            <dd>
              {sec(k === 0 ? firstMs : emptyMs)} s, {cb.payments} paid
            </dd>
          </div>
        ))}
      </dl>

      <div className="qr-foot">
        <a className="sl-link" href={batch.links.repay} target="_blank" rel="noreferrer">
          The repayment on Base Sepolia
        </a>
        {!reduce && (
          <button type="button" className="sl-btn small" onClick={play} disabled={phase === "running"}>
            {phase === "running" ? "Replaying" : "Replay"}
          </button>
        )}
      </div>
    </div>
  );
}
