"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PixelGlyph } from "./PixelGlyph";

type Side = "l" | "r" | "t" | "b";
type EdgeDef = { id: string; from: string; fs: Side; to: string; ts: Side; label: string; paid?: boolean };

// How the money moves, node to node.
const EDGES: EdgeDef[] = [
  { id: "join", from: "lender", fs: "r", to: "vault", ts: "l", label: "Join queue" },
  { id: "event", from: "morpho", fs: "b", to: "reactive", ts: "t", label: "Repayment" },
  { id: "callback", from: "reactive", fs: "b", to: "vault", ts: "t", label: "Callback" },
  { id: "paid", from: "vault", fs: "r", to: "paid", ts: "l", label: "Paid in order", paid: true },
];

type Drawn = { id: string; d: string; label: string; lx: number; ly: number; anchor: "middle" | "start"; paid: boolean };

const point = (r: DOMRect, c: DOMRect, side: Side): [number, number] => {
  const l = r.left - c.left;
  const t = r.top - c.top;
  if (side === "r") return [l + r.width, t + r.height / 2];
  if (side === "l") return [l, t + r.height / 2];
  if (side === "b") return [l + r.width / 2, t + r.height];
  return [l + r.width / 2, t];
};

function Card({ id, reg, tone, children, className }: { id: string; reg: (id: string, el: HTMLDivElement | null) => void; tone: string; children: ReactNode; className?: string }) {
  return (
    <div ref={(el) => reg(id, el)} className={`wf-card${className ? " " + className : ""}`} style={{ "--c": tone } as CSSProperties}>
      {children}
    </div>
  );
}

/**
 * The protocol as a graph: who talks to whom, left to right. The lines are measured from the real card positions, so they
 * follow the layout at any width; each one draws itself in when the graph scrolls into view and carries a pixel packet along it.
 * On a phone the cards simply stack, with the label of each hand-off above the next card.
 */
export function WorkflowGraph({ medianS, batch }: { medianS?: number; batch?: { n: number; callbacks: number } }) {
  const box = useRef<HTMLDivElement>(null);
  const nodes = useRef<Record<string, HTMLDivElement | null>>({});
  const [edges, setEdges] = useState<Drawn[]>([]);
  const [drawn, setDrawn] = useState(false);
  const [still, setStill] = useState(false);
  const reg = (id: string, el: HTMLDivElement | null) => {
    nodes.current[id] = el;
  };

  useEffect(() => {
    setStill(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    const el = box.current;
    if (!el) return;
    const measure = () => {
      const c = el.getBoundingClientRect();
      const out: Drawn[] = [];
      for (const e of EDGES) {
        const a = nodes.current[e.from];
        const b = nodes.current[e.to];
        if (!a || !b) continue;
        const [x0, y0] = point(a.getBoundingClientRect(), c, e.fs);
        const [x1, y1] = point(b.getBoundingClientRect(), c, e.ts);
        if (e.fs === "r" || e.fs === "l") {
          const dx = (x1 - x0) * 0.5;
          out.push({ id: e.id, d: `M${x0} ${y0} C${x0 + dx} ${y0} ${x1 - dx} ${y1} ${x1} ${y1}`, label: e.label, lx: (x0 + x1) / 2, ly: (y0 + y1) / 2 - 12, anchor: "middle", paid: !!e.paid });
        } else {
          out.push({ id: e.id, d: `M${x0} ${y0} L${x1} ${y1}`, label: e.label, lx: x0 + 12, ly: (y0 + y1) / 2 + 4, anchor: "start", paid: !!e.paid });
        }
      }
      setEdges(out);
    };
    measure();
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    });
    ro.observe(el);
    void document.fonts?.ready.then(measure);
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.25 },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  return (
    <div className={`wf${drawn ? " drawn" : ""}`}>
      <div ref={box} className="wf-grid">
        <svg className="wf-svg" aria-hidden="true">
          {edges.map((e, i) => (
            <g key={e.id}>
              <path className={`wf-path${e.paid ? " paid" : ""}`} d={e.d} pathLength={1} />
              <text className="wf-edge" x={e.lx} y={e.ly} textAnchor={e.anchor}>
                {e.label}
              </text>
              {!still && drawn && (
                <rect className={`wf-packet${e.paid ? " paid" : ""}`} width="6" height="6" x="-3" y="-3">
                  <animateMotion dur="3.6s" begin={`${1.4 + i * 0.7}s`} repeatCount="indefinite" path={e.d} />
                </rect>
              )}
            </g>
          ))}
        </svg>

        <div className="wf-col">
          <Card id="lender" reg={reg} tone="#c8c8ce">
            <div className="wf-top">
              <span className="wf-ico">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
                  <circle cx="10" cy="7" r="3.2" />
                  <path d="M3.5 17c.8-3.4 3.4-5 6.5-5s5.7 1.6 6.5 5" />
                </svg>
              </span>
              <span className="wf-tag">Lender</span>
            </div>
            <h3>Withdrawal request</h3>
            <ul>
              <li>Asks for more cash than the vault has on hand</li>
              <li>Joins the queue, first come first served</li>
            </ul>
          </Card>
          <div className="wf-step">Step 01</div>
        </div>

        <div className="wf-col mid">
          <span className="wf-edge-m">Liquidity returns</span>
          <Card id="morpho" reg={reg} tone="#c8c8ce">
            <div className="wf-top">
              <span className="wf-mark">
                <PixelGlyph name="wing" />
                Morpho
              </span>
              <span className="wf-tag">Liquidity</span>
            </div>
            <h3>Liquidity returns</h3>
            <p>A borrower repays in a market we don&apos;t control, a deposit lands, or another chain has spare credit.</p>
          </Card>
          <span className="wf-edge-m">Repayment event</span>
          <Card id="reactive" reg={reg} tone="#a27cff">
            <div className="wf-top">
              <span className="wf-mark">
                <PixelGlyph name="bolt" />
                Reactive
              </span>
              <span className="wf-tag">Reaction</span>
            </div>
            <h3>Reactive decides</h3>
            <p>SluiceReactive sees the event on Lasna and tells the vault to pull from Morpho, or the reserve to front the shortfall.</p>
            {(medianS !== undefined || batch) && (
              <div className="wf-code">
                <b>event</b> Repay on Morpho
                {medianS !== undefined && (
                  <>
                    {"\n"}
                    <b>median</b> {medianS.toFixed(2)} s, repay to paid
                  </>
                )}
                {batch && (
                  <>
                    {"\n"}
                    <b>batch</b> {batch.n} paid in {batch.callbacks} callbacks
                  </>
                )}
              </div>
            )}
          </Card>
          <span className="wf-edge-m">Callback</span>
          <Card id="vault" reg={reg} tone="#e8e8ec">
            <div className="wf-top">
              <span className="wf-mark">
                <PixelGlyph name="disc" />
                Sluice
              </span>
              <span className="wf-tag">Queue</span>
            </div>
            <h3>Pays the queue in order</h3>
            <p>First come, first served, with partial fills at the head. Missed events heal through retries, and bad debt halts cross-chain fronting.</p>
          </Card>
        </div>

        <div className="wf-col">
          <span className="wf-edge-m">Paid in order</span>
          <Card id="paid" reg={reg} tone="#e7bd72">
            <div className="wf-top">
              <span className="wf-ico">
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 3v9m0 0-3.5-3.5M10 12l3.5-3.5M4 16h12" />
                </svg>
              </span>
              <span className="wf-tag">Paid</span>
            </div>
            <h3>Withdrawal settled</h3>
            <ul>
              <li>Paid by the callback, in the order they joined</li>
              <li>No manager and no keeper bot</li>
              <li>Every step carries a transaction hash</li>
            </ul>
          </Card>
          <div className="wf-step end">Final</div>
        </div>
      </div>
    </div>
  );
}
