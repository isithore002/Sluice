"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Role } from "./roles";
import "./demo-tutorial.css";

interface Chapter {
  /** Short name for the progress list. */
  name: string;
  title: string;
  /** Which wallet does this chapter, if any. */
  who?: Role;
  intro: ReactNode;
  /** Numbered actions; button labels are written exactly as they appear on the page. */
  steps: ReactNode[];
  /** What the visitor should see when the chapter is done. */
  result?: ReactNode;
  /** Offer to open this role's tab when closing the tutorial. */
  open?: Role;
}

const FAUCETS = [
  { name: "Coinbase faucet", url: "https://portal.cdp.coinbase.com/products/faucet" },
  { name: "Alchemy faucet", url: "https://www.alchemy.com/faucets/base-sepolia" },
];

const B = ({ children }: { children: ReactNode }) => <span className="tut-btn-label">{children}</span>;

const CHAPTERS: Chapter[] = [
  {
    name: "Set up",
    title: "Set up two wallets (once)",
    intro: (
      <>
        You play both sides: a <b>lender</b> and a <b>borrower</b>. They must be two different wallets, so the run shows two people and not one person doing
        both. A whole run takes about three minutes, and everything runs on free testnet tokens.
      </>
    ),
    steps: [
      <>
        In MetaMask, create a second account (account menu → <b>Add account</b>). Use <b>Account 1 as the lender</b> and <b>Account 2 as the borrower</b>. Two
        browser profiles also work.
      </>,
      <>
        Put a little <b>Base Sepolia ETH</b> in both accounts for gas (well under 0.0001 ETH covers a whole run):{" "}
        {FAUCETS.map((f, i) => (
          <span key={f.url}>
            {i > 0 && " or "}
            <a className="sl-link" href={f.url} target="_blank" rel="noreferrer">
              {f.name}
            </a>
          </span>
        ))}
        .
      </>,
      <>
        Using <b>Phantom</b>? Turn on Testnet Mode first (Settings → Developer Settings → Testnet Mode).
      </>,
      <>
        Everything else (mUSD, the collateral) is a free test token you mint on the page. There is nothing to buy.
      </>,
    ],
    result: <>You have two accounts, each with a little Base Sepolia ETH.</>,
  },
  {
    name: "Lender deposits",
    title: "The lender deposits",
    who: "lender",
    intro: <>Select the lender account (Account 1) in your wallet, then open the Lender tab under “Your turn”.</>,
    steps: [
      <>
        Click <B>Connect the lender wallet →</B> and pick your wallet. If asked, click <B>Switch to Base Sepolia</B>.
      </>,
      <>
        Step 1, Get demo mUSD: click <B>Mint 10 mUSD</B> and confirm in the wallet.
      </>,
      <>
        Step 2, Let Sluice take your mUSD: click <B>Approve</B> and confirm.
      </>,
      <>
        Step 3, Deposit into Sluice: click <B>Deposit 10 mUSD</B> and confirm. The vault lends it out through the Morpho market.
      </>,
      <>Stop here: leave step 4 for later.</>,
    ],
    result: <>Steps 1 to 3 show “done”. The pool above counts your 10 mUSD as supplied.</>,
    open: "lender",
  },
  {
    name: "Borrower borrows",
    title: "The borrower empties the pool",
    who: "borrower",
    intro: (
      <>
        Switch your wallet to the borrower account (Account 2), then open the Borrower tab. If the page still shows the lender, click{" "}
        <B>Use a different account or wallet</B>.
      </>
    ),
    steps: [
      <>
        <B>Mint collateral</B>, then <B>Approve</B>, then <B>Supply collateral</B>: three confirmations that lock free test collateral in Morpho.
      </>,
      <>
        Step 4, Borrow the pool&apos;s free cash: click <B>Borrow … mUSD</B>. The amount is whatever cash the pool still has, so after this it is 100% lent
        out.
      </>,
      <>Don&apos;t repay yet.</>,
    ],
    result: (
      <>
        The pool shows <b>Free cash 0</b> and <b>100%</b> utilization: “lenders who ask now wait in line”.
      </>
    ),
    open: "borrower",
  },
  {
    name: "Lender gets a ticket",
    title: "The lender asks for the money back",
    who: "lender",
    intro: <>Switch the wallet back to the lender account (Account 1) and open the Lender tab.</>,
    steps: [
      <>
        Step 4, Ask for your money back: click <B>Withdraw 10 mUSD</B> and confirm.
      </>,
      <>The pool has no cash, so instead of paying you, Sluice gives you a numbered ticket in line. First come, first served.</>,
    ],
    result: (
      <>
        The tab says <b>“Waiting for cash. Nothing for you to do.”</b> with your ticket number, and the queue above shows your ticket.
      </>
    ),
    open: "lender",
  },
  {
    name: "Borrower repays",
    title: "The borrower repays",
    who: "borrower",
    intro: <>Switch the wallet to the borrower account (Account 2) and open the Borrower tab.</>,
    steps: [
      <>
        Let Morpho take your repayment: click <B>Approve</B> and confirm.
      </>,
      <>
        Repay the loan on Morpho: click <B>Repay … mUSD</B> and confirm. This is the one click that matters: it is an ordinary Morpho repayment and does not
        call Sluice.
      </>,
    ],
    result: <>The repayment puts cash back in the pool. You don&apos;t press anything else.</>,
    open: "borrower",
  },
  {
    name: "Reactive pays",
    title: "Watch Reactive pay the ticket",
    intro: (
      <>
        A Reactive contract on Omni sees the repayment and pays the queue in order, usually within a couple of seconds. Nobody calls Sluice: not you, not us.
      </>
    ),
    steps: [
      <>Switch back to the lender account and open the Lender tab.</>,
      <>
        It shows <b>“✓ Paid by Reactive”</b>: the amount, your ticket, the payout transaction, and <b>Sent by: Reactive&apos;s signer</b>.
      </>,
      <>
        Every line links to the block explorer. Check the payout transaction: it was sent by Reactive&apos;s callback signer, on its own.
      </>,
      <>
        To go again, click <B>Start over</B>.
      </>,
    ],
    result: (
      <>
        Seen the whole loop? The <b>Evidence</b> and <b>Latency</b> sections below have the 40-lender run, the race against a bot and every measured loop.
      </>
    ),
    open: "lender",
  },
];

const TIPS: ReactNode[] = [
  <>
    <b>Paid on the spot instead of getting a ticket?</b> The pool still had cash. Have the borrower borrow all of the free cash first (chapter 3), then ask again.
  </>,
  <>
    <b>“This is the wallet you used as the borrower”?</b> The lender and the borrower must be different accounts. Switch accounts in your wallet.
  </>,
  <>
    <b>A step is greyed out?</b> That wallet has no Base Sepolia ETH for gas. Use a faucet from chapter 1.
  </>,
  <>
    <b>The wallet warns about an unfamiliar site or contract?</b> These are testnet contracts with free test tokens. Every address is listed and verified under
    Contracts at the bottom of this page.
  </>,
];

/**
 * "Tutorial" button and a step-by-step guide through one full live run: two wallets, deposit, borrow, ticket, repay, paid by Reactive.
 * Uses a native <dialog> (focus is trapped, Escape closes it). `onOpenRole` switches the demo to a role's tab.
 */
export function Tutorial({ onOpenRole }: { onOpenRole: (role: Role) => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const [i, setI] = useState(0);
  const c = CHAPTERS[i];
  const last = i === CHAPTERS.length - 1;
  const tipsIndex = CHAPTERS.length;
  const onTips = i === tipsIndex;

  function open() {
    setI(0);
    if (dlg.current && !dlg.current.open) dlg.current.showModal();
    document.documentElement.classList.add("tut-lock");
  }

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    const onClose = () => document.documentElement.classList.remove("tut-lock");
    d.addEventListener("close", onClose);
    // "#tutorial" in the address (the Tutorial links in the page navigation) opens the guide; the hash is then cleared so
    // the same link works again.
    const fromHash = () => {
      if (window.location.hash !== "#tutorial") return;
      history.replaceState(null, "", window.location.pathname + window.location.search);
      open();
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => {
      d.removeEventListener("close", onClose);
      window.removeEventListener("hashchange", fromHash);
    };
  }, []);
  function close() {
    dlg.current?.close();
  }
  function goTo(role: Role) {
    close();
    onOpenRole(role);
    document.getElementById("dm-console")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <div className="tut-cta sl-card" id="tutorial">
        <div>
          <p className="tut-cta-k">First time here?</p>
          <p className="tut-cta-t">Follow the tutorial: one full run, from deposit to “Paid by Reactive”, in about three minutes.</p>
        </div>
        <button className="sl-btn primary tut-open" onClick={open} aria-haspopup="dialog">
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5zM4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          </svg>
          Tutorial
        </button>
      </div>

      <dialog ref={dlg} className="tut" aria-labelledby="tut-title">
        <div className="tut-head">
          <p className="tut-kicker">Live demo tutorial</p>
          <button className="tut-x" onClick={close} aria-label="Close the tutorial">
            ×
          </button>
        </div>

        <ol className="tut-progress" aria-label="Chapters">
          {CHAPTERS.map((ch, k) => (
            <li key={ch.name}>
              <button className={k === i ? "on" : k < i ? "done" : ""} aria-current={k === i ? "step" : undefined} onClick={() => setI(k)}>
                <span className="tut-dot">{k < i ? "✓" : k + 1}</span>
                <span className="tut-name">{ch.name}</span>
              </button>
            </li>
          ))}
          <li>
            <button className={onTips ? "on" : ""} aria-current={onTips ? "step" : undefined} onClick={() => setI(tipsIndex)}>
              <span className="tut-dot">?</span>
              <span className="tut-name">If stuck</span>
            </button>
          </li>
        </ol>

        <div className="tut-body" aria-live="polite">
          {onTips ? (
            <>
              <h3 id="tut-title">If something looks off</h3>
              <ul className="tut-tips">
                {TIPS.map((t, k) => (
                  <li key={k}>{t}</li>
                ))}
              </ul>
            </>
          ) : (
            <>
              <h3 id="tut-title">
                <span>
                  <span className="tut-n">{i + 1}.</span> {c.title}
                </span>
                {c.who && <span className={`tut-who ${c.who}`}>{c.who === "lender" ? "Lender · Account 1" : "Borrower · Account 2"}</span>}
              </h3>
              <p className="tut-intro">{c.intro}</p>
              <ol className="tut-steps">
                {c.steps.map((s, k) => (
                  <li key={k}>{s}</li>
                ))}
              </ol>
              {c.result && (
                <p className="tut-result">
                  <span aria-hidden="true">→</span> {c.result}
                </p>
              )}
            </>
          )}
        </div>

        <div className="tut-foot">
          <button className="sl-btn small" onClick={() => setI((k) => Math.max(0, k - 1))} disabled={i === 0}>
            ← Back
          </button>
          <div className="tut-foot-r">
            {!onTips && c.open && (
              <button className="sl-btn small" onClick={() => goTo(c.open!)}>
                Open the {c.open === "lender" ? "Lender" : "Borrower"} tab
              </button>
            )}
            {onTips ? (
              <button className="sl-btn small primary" onClick={close}>
                Close
              </button>
            ) : (
              <button className="sl-btn small primary" onClick={() => setI((k) => k + 1)}>
                {last ? "Tips if stuck →" : "Next →"}
              </button>
            )}
          </div>
        </div>
      </dialog>
    </>
  );
}
