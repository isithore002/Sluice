"use client";

import { useEffect, useMemo, useState } from "react";
import { RaceChart } from "../components/RaceChart";
import { addrUrl, CHAINS, txUrl, type ChainKey } from "../lib/config";
import { loadManifest, type Manifest, type Stats } from "../lib/manifest";
import { useLive } from "../lib/useLive";

const usd = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 2 });
const secs = (ms: number) => (Number.isFinite(ms) ? `${(ms / 1000).toFixed(2)} s` : "n/a");
const ago = (t: number | null) => {
  if (!t) return "";
  const s = Math.max(0, Math.round(Date.now() / 1000 - t));
  return s < 60 ? `${s}s ago` : s < 3600 ? `${Math.round(s / 60)}m ago` : `${Math.round(s / 3600)}h ago`;
};

/** Reactive's signer, observed sending every callback on Base Sepolia and Unichain Sepolia. */
const REACTIVE_SIGNER = "0xf7e866d726658f6c3f14b8ee537fe268a4d91ddb";
const whoSent = (from: string | null) =>
  !from ? "" : from.toLowerCase() === REACTIVE_SIGNER ? "sent by Reactive's signer" : `sent by ${from.slice(0, 6)}…${from.slice(-4)}`;

function Status({ ok, good, bad }: { ok: boolean; good: string; bad: string }) {
  return (
    <span className={`status ${ok ? "good" : "critical"}`}>
      <span className="dot" aria-hidden="true" />
      {ok ? `✓ ${good}` : `! ${bad}`}
    </span>
  );
}

function StatRow({ name, s }: { name: string; s: Stats }) {
  return (
    <tr>
      <td>{name}</td>
      <td className="num">{secs(s.median)}</td>
      <td className="num">{secs(s.p95)}</td>
      <td className="num">{secs(s.max)}</td>
      <td className="num">{s.n}</td>
    </tr>
  );
}

export default function Page() {
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  useEffect(() => {
    loadManifest().then(setManifest).catch((e) => setLoadError(String(e)));
  }, []);

  const addresses = useMemo(() => (manifest?.deployed ? manifest.addresses : null), [manifest]);
  const { state, events, error, updatedAt } = useLive(addresses);
  const summary = manifest?.summary ?? null;
  const A = manifest?.addresses ?? {};

  const util = state && state.supply > 0n ? Number((state.borrow * 10000n) / state.supply) / 100 : 0;
  const anyDebt = state ? Object.values(state.debts).some((d) => d > 0n) : false;

  return (
    <main className="wrap">
      <header>
        <h1>Sluice</h1>
        <p className="lede">
          Withdrawal queues that settle themselves. When liquidity comes back anywhere (a repayment in a Morpho market
          Sluice doesn&apos;t control, or spare credit on another chain), a Reactive contract pays the queue in order, with
          no manager and no bot.
        </p>
        <div className="chips">
          <span className="chip base">Base Sepolia · vault, Morpho, reserve</span>
          <span className="chip lasna">Reactive Lasna · SluiceReactive</span>
          <span className="chip uni">Unichain Sepolia · sibling vault</span>
        </div>
      </header>

      <section>
        <h2>How it works</h2>
        <div className="flow">
          <div className="col">
            <h4>1. Something frees liquidity</h4>
            <ol>
              <li>A borrower repays in the Morpho market (Base)</li>
              <li>…or Base can&apos;t cover the queue, but Unichain has spare credit</li>
              <li>A deposit pays the queue directly, in the same transaction</li>
            </ol>
          </div>
          <div className="col">
            <h4>2. Reactive decides (Lasna, ~1 s)</h4>
            <ol>
              <li>SluiceReactive sees the event</li>
              <li>Asks the vault to pull from Morpho, or the reserve to front the shortfall</li>
              <li>Only after the front is confirmed, asks Unichain to reimburse exactly what was sent</li>
            </ol>
          </div>
          <div className="col">
            <h4>3. The queue is paid in order</h4>
            <ol>
              <li>First come, first served, partial fills at the head</li>
              <li>Nobody can jump the queue while people wait</li>
              <li>Retries heal missed events; bad debt halts cross-chain fronting</li>
            </ol>
          </div>
        </div>
      </section>

      {summary && summary.race.length > 0 && (
        <section>
          <h2>Why Omni: the latency race</h2>
          <p className="sub">
            Freed liquidity is contested: a competitor bot tries to grab it a few seconds after each repayment. Share
            captured by the queue, at Omni speed vs the same system slowed to legacy-like speed.
          </p>
          <div className="card">
            <RaceChart cells={summary.race} />
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Sluice speed</th>
                    <th className="num">Competitor delay</th>
                    <th className="num">Rounds</th>
                    <th className="num">Queue captured</th>
                    <th className="num">Sluice acted (median)</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.race.map((c) => (
                    <tr key={`${c.delayBlocks}-${c.competitorDelayS}`}>
                      <td>{c.delayBlocks === 0 ? "Omni native" : `+${c.delayBlocks} Lasna blocks (~legacy)`}</td>
                      <td className="num">{c.competitorDelayS} s</td>
                      <td className="num">{c.rounds}</td>
                      <td className="num">{Math.round(c.meanCapture * 100)}%</td>
                      <td className="num">{secs(c.sluiceActedMs.median)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note">
              The legacy-like rows add delay on Omni; they are not runs on the legacy network. A competitor in the same
              block beats any reactive system.
            </p>
          </div>
        </section>
      )}

      {summary && (summary.flowB.succeeded > 0 || summary.flowC.succeeded > 0) && (
        <section>
          <h2>Measured latency</h2>
          <p className="sub">Live loops on testnet, traced end to end by the origin transaction hash.</p>
          <div className="card table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Loop</th>
                  <th className="num">Median</th>
                  <th className="num">p95</th>
                  <th className="num">Max</th>
                  <th className="num">Loops</th>
                </tr>
              </thead>
              <tbody>
                {summary.flowB.succeeded > 0 && <StatRow name="Morpho repay → queue paid" s={summary.flowB.totalWallMs} />}
                {summary.flowB.succeeded > 0 && <StatRow name="  repay → Lasna react" s={summary.flowB.originToReactiveWallMs} />}
                {summary.flowC.succeeded > 0 && <StatRow name="Shortfall → user paid by reserve" s={summary.flowC.userPaidWallMs} />}
                {summary.flowC.succeeded > 0 && <StatRow name="Shortfall → relayer reimbursed (Unichain)" s={summary.flowC.relayerReimbursedWallMs} />}
                {summary.independent?.succeeded > 0 && <StatRow name="Outsider repay → queue paid (separate wallets)" s={summary.independent.totalWallMs} />}
              </tbody>
            </table>
            <p className="note">
              Success: flow B {summary.flowB.succeeded}/{summary.flowB.attempted}, flow C {summary.flowC.succeeded}/
              {summary.flowC.attempted}. Wall-clock times include up to ~150 ms of polling delay.
            </p>
          </div>
        </section>
      )}

      {summary && (summary.flowB.example || summary.flowC.example) && (
        <section>
          <h2>Verified example loops</h2>
          <p className="sub">One real loop of each flow. Open each transaction on its explorer and follow the chain of events yourself.</p>
          <div className="grid">
            {summary.flowB.example && (
              <div className="card">
                <h3>Flow B: Morpho repayment → queue paid</h3>
                <ol className="hops">
                  <li><a href={summary.flowB.example.origin} target="_blank" rel="noreferrer">Borrower repays in Morpho (Base Sepolia) ↗</a></li>
                  <li><a href={summary.flowB.example.reactive} target="_blank" rel="noreferrer">SluiceReactive reacts (Reactive Lasna) ↗</a></li>
                  <li><a href={summary.flowB.example.callback} target="_blank" rel="noreferrer">Callback pays the queue (Base Sepolia) ↗</a></li>
                </ol>
              </div>
            )}
            {summary.flowC.example && (
              <div className="card">
                <h3>Flow C: shortfall → fronted → reimbursed</h3>
                <ol className="hops">
                  <li><a href={summary.flowC.example.origin} target="_blank" rel="noreferrer">Withdrawal queued with a shortfall (Base Sepolia) ↗</a></li>
                  <li><a href={summary.flowC.example.reactive} target="_blank" rel="noreferrer">SluiceReactive reacts (Reactive Lasna) ↗</a></li>
                  <li><a href={summary.flowC.example.front} target="_blank" rel="noreferrer">Reserve fronts, user paid (Base Sepolia) ↗</a></li>
                  <li><a href={summary.flowC.example.reimburse} target="_blank" rel="noreferrer">Relayer reimbursed (Unichain Sepolia) ↗</a></li>
                </ol>
              </div>
            )}
            {summary.independent?.example && (
              <div className="card">
                <h3>Independent actors: a user and an outsider</h3>
                <ol className="hops">
                  <li><a href={summary.independent.example.links.queued} target="_blank" rel="noreferrer">Alice (a user) queues a withdrawal ↗</a></li>
                  <li><a href={summary.independent.example.links.origin} target="_blank" rel="noreferrer">Bob, an outsider, repays in Morpho ↗</a></li>
                  <li><a href={summary.independent.example.links.reactive} target="_blank" rel="noreferrer">SluiceReactive reacts (Lasna) ↗</a></li>
                  <li><a href={summary.independent.example.links.callback} target="_blank" rel="noreferrer">Callback pays Alice ↗</a></li>
                </ol>
                <p className="note">
                  {summary.independent.succeeded}/{summary.independent.attempted} loops with separate wallets for the user and the repayer; the deployer sent none of these transactions.
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <section>
        <h2>Live state</h2>
        {!manifest && !loadError && <p className="sub">Loading…</p>}
        {loadError && <p className="err">{loadError}</p>}
        {manifest && !manifest.deployed && (
          <div className="banner">Not deployed yet. Run scripts/deploy.sh, then rebuild the dashboard.</div>
        )}
        {manifest?.deployed && (
          <>
            <p className="sub">
              Refreshes every few seconds{updatedAt ? ` · updated ${new Date(updatedAt).toLocaleTimeString()}` : ""}
              {error ? "" : ""}
            </p>
            {error && <p className="err">RPC error: {error}</p>}
            {state && (
              <div className="grid">
                <div className="card">
                  <h3>Morpho market</h3>
                  <div className="big">{util}% utilized</div>
                  <div className="meter">
                    <div style={{ width: `${Math.min(100, util)}%` }} />
                  </div>
                  <div className="kv">
                    <span>Supplied / borrowed</span>
                    <span>
                      {usd(state.supply)} / {usd(state.borrow)}
                    </span>
                  </div>
                </div>
                <div className="card">
                  <h3>Withdrawal queue</h3>
                  <div className="big">{usd(state.pending)} mUSD</div>
                  <div className="kv">
                    <span>Requests waiting</span>
                    <span>{state.queued.toString()}</span>
                  </div>
                  <div className="kv">
                    <span>Shortfall beyond Morpho</span>
                    <span>{usd(state.shortfall)}</span>
                  </div>
                </div>
                <div className="card">
                  <h3>Cross-chain</h3>
                  <div className="kv">
                    <span>Reserve inventory (Base)</span>
                    <span>{usd(state.inventory)}</span>
                  </div>
                  <div className="kv">
                    <span>Credit (Unichain)</span>
                    <span>{usd(state.credit)}</span>
                  </div>
                  <div className="kv">
                    <span>Fills opened / open</span>
                    <span>
                      {state.fillsOpened.toString()} / {state.fillsOpen}
                    </span>
                  </div>
                </div>
                <div className="card">
                  <h3>Reactive contract</h3>
                  <div className="kv">
                    <span>Speed</span>
                    <span>{state.delayBlocks === 0n ? "native" : `+${state.delayBlocks} blocks (race)`}</span>
                  </div>
                  <div className="kv">
                    <span>Cross-chain fronting</span>
                    <span>{state.halted ? "halted" : "on"}</span>
                  </div>
                  <div className="kv">
                    <span>Pull in flight</span>
                    <span>{state.pullPending ? "yes" : "no"}</span>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <Status ok={!anyDebt} good="All contracts funded" bad="A contract is in debt" />
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {manifest?.deployed && (
        <section>
          <h2>Live events across the three chains</h2>
          <div className="card">
            {events.length === 0 ? (
              <p className="sub">No recent events.</p>
            ) : (
              <ul className="feed">
                {events.map((e) => (
                  <li key={e.id}>
                    <span>
                      <span className={`chip ${e.chain}`}>{CHAINS[e.chain].label.split(" ")[0]}</span>{" "}
                      <span className="when">{ago(e.time)}</span>
                    </span>
                    <span>
                      {e.text}
                      {e.from && <span className={`who${e.from.toLowerCase() === REACTIVE_SIGNER ? " reactive" : ""}`}>{whoSent(e.from)}</span>}
                    </span>
                    <a href={txUrl(e.chain, e.tx)} target="_blank" rel="noreferrer">
                      tx ↗
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {manifest?.deployed && (
        <section>
          <h2>Contracts</h2>
          <div className="card table-scroll">
            <table>
              <tbody>
                {(
                  [
                    ["SluiceReactive", "lasna", A.sluiceReactive],
                    ["SluiceVault", "base", A.sluiceVault],
                    ["RelayerReserve", "base", A.relayerReserve],
                    ["Morpho Blue", "base", A.morpho],
                    ["SiblingVault", "uni", A.siblingVault],
                  ] as [string, ChainKey, string][]
                ).map(([name, k, a]) => (
                  <tr key={name}>
                    <td>{name}</td>
                    <td>{CHAINS[k].label}</td>
                    <td>
                      <a href={addrUrl(k, a)} target="_blank" rel="noreferrer" style={{ fontFamily: "var(--mono)", fontSize: 13 }}>
                        {a}
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <footer>
        Built for the Reactive Omni Buildathon · <a href="https://github.com/isithore002/Sluice">source on GitHub</a>
      </footer>
    </main>
  );
}
