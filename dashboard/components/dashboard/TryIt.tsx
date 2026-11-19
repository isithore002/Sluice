"use client";

import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, parseAbi, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { vaultAbi } from "../../lib/abis";
import { addrUrl, clients, txUrl } from "../../lib/config";
import { isReactiveSigner, secs, short, usdStr } from "./format";

const oneClickAbi = parseAbi(["function settle()", "function AMOUNT() view returns (uint256)"]);
const BASE_SEPOLIA = "0x14a34"; // 84532
const FAUCETS = [
  { name: "Coinbase Developer Platform faucet", url: "https://portal.cdp.coinbase.com/products/faucet" },
  { name: "Alchemy faucet", url: "https://www.alchemy.com/faucets/base-sepolia" },
];

interface Eip1193 {
  request: (a: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, fn: (...a: unknown[]) => void) => void;
  removeListener?: (event: string, fn: (...a: unknown[]) => void) => void;
}

type Step = "idle" | "connecting" | "ready" | "signing" | "mining" | "waiting" | "done" | "error";

interface Outcome {
  tx: Hex;
  callback: Hex;
  sender: string;
  paid: bigint;
  requestId: bigint;
  afterMinedMs: number;
}

function errText(e: unknown): string {
  const err = e as { code?: number; shortMessage?: string; message?: string };
  if (err?.code === 4001) return "You rejected the request in your wallet.";
  return (err?.shortMessage || err?.message || String(e)).split("\n")[0];
}

async function ensureBaseSepolia(p: Eip1193) {
  const id = String(await p.request({ method: "eth_chainId" })).toLowerCase();
  if (id === BASE_SEPOLIA) return;
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_SEPOLIA }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: BASE_SEPOLIA,
          chainName: "Base Sepolia",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: ["https://sepolia.base.org"],
          blockExplorerUrls: ["https://sepolia.basescan.org"],
        },
      ],
    });
  }
}

/**
 * "Settle it yourself": a visitor's own wallet sends ONE transaction (OneClickRepay.settle), which repays part of the
 * demo borrower's Morpho debt. Nothing here calls Sluice: Reactive sees the repayment and pays the head of the queue.
 * The panel then finds that payout on-chain by its trace id, which is the visitor's own transaction hash.
 */
export function TryIt({ addresses, queued }: { addresses: Record<string, string>; queued: bigint | null }) {
  const oneClick = addresses.oneClickRepay as Address | undefined;
  const vault = addresses.sluiceVault as Address;
  const [provider, setProvider] = useState<Eip1193 | null>(null);
  const [checked, setChecked] = useState(false);
  const [account, setAccount] = useState<Address | null>(null);
  const [eth, setEth] = useState<bigint | null>(null);
  const [amount, setAmount] = useState<bigint>(10_000_000n);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    const injected = (window as unknown as { ethereum?: Eip1193 }).ethereum;
    if (injected) setProvider(injected);
    setChecked(true);
    if (oneClick) {
      clients.base
        .readContract({ address: oneClick, abi: oneClickAbi, functionName: "AMOUNT" })
        .then(setAmount)
        .catch(() => {});
    }
  }, [oneClick]);

  // A wallet switch resets the panel.
  useEffect(() => {
    if (!provider?.on) return;
    const reset = () => {
      setAccount(null);
      setStep("idle");
      setOutcome(null);
      setTx(null);
    };
    provider.on("accountsChanged", reset);
    return () => provider.removeListener?.("accountsChanged", reset);
  }, [provider]);

  const refreshBalance = useCallback(async (a: Address) => {
    try {
      setEth(await clients.base.getBalance({ address: a }));
    } catch {
      /* balance stays unknown */
    }
  }, []);

  async function connect() {
    if (!provider) return;
    setError(null);
    setStep("connecting");
    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      await ensureBaseSepolia(provider);
      const a = accounts[0] as Address;
      setAccount(a);
      await refreshBalance(a);
      setStep("ready");
    } catch (e) {
      setError(errText(e));
      setStep("error");
    }
  }

  async function settle() {
    if (!provider || !account || !oneClick) return;
    setError(null);
    setOutcome(null);
    setTx(null);
    setStep("signing");
    try {
      await ensureBaseSepolia(provider);
      const wallet = createWalletClient({ chain: baseSepolia, transport: custom(provider), account });
      const hash = await wallet.writeContract({ address: oneClick, abi: oneClickAbi, functionName: "settle", account, chain: baseSepolia });
      setTx(hash);
      setStep("mining");
      const rc = await clients.base.waitForTransactionReceipt({ hash, pollingInterval: 300, timeout: 120_000 });
      if (rc.status !== "success") throw new Error("Your transaction reverted. The demo may need re-arming.");
      const minedAt = Date.now();
      setStep("waiting");

      // The payout carries the visitor's transaction hash as its trace id. Base Sepolia's public RPC serves at most
      // 200 blocks of logs per query, and 190 blocks of 200 ms is far longer than a settlement takes.
      const trace = BigInt(hash);
      const deadline = Date.now() + 60_000;
      while (Date.now() < deadline) {
        const latest = await clients.base.getBlockNumber();
        const to = latest < rc.blockNumber + 190n ? latest : rc.blockNumber + 190n;
        const logs = await clients.base.getContractEvents({ address: vault, abi: vaultAbi, eventName: "WithdrawSettled", fromBlock: rc.blockNumber, toBlock: to });
        const hit = logs.find((l) => l.args.traceId === trace);
        if (hit) {
          const cb = await clients.base.getTransaction({ hash: hit.transactionHash! });
          setOutcome({
            tx: hash,
            callback: hit.transactionHash!,
            sender: cb.from,
            paid: hit.args.paid ?? 0n,
            requestId: hit.args.requestId ?? 0n,
            afterMinedMs: Date.now() - minedAt,
          });
          setStep("done");
          void refreshBalance(account);
          return;
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      throw new Error("No settlement seen within 60 s. Check the live events below: Reactive may still be catching up.");
    } catch (e) {
      setError(errText(e));
      setStep("error");
    }
  }

  const empty = queued !== null && queued === 0n;
  const busy = step === "connecting" || step === "signing" || step === "mining" || step === "waiting";

  return (
    <div className="ti">
      <div className="sl-card ti-how">
        <h3>What happens</h3>
        <ol className="ti-steps">
          <li>
            <b>Your wallet sends one transaction</b> to{" "}
            {oneClick ? (
              <a className="sl-link sl-mono" href={addrUrl("base", oneClick)} target="_blank" rel="noreferrer">
                OneClickRepay
              </a>
            ) : (
              "OneClickRepay"
            )}
            . It mints {usdStr(amount.toString())} demo mUSD (anyone can) and repays that much of the demo borrower&apos;s debt in Morpho.
          </li>
          <li>
            <b>Reactive notices the repayment</b> on Lasna. Sluice never sees your transaction directly.
          </li>
          <li>
            <b>Reactive&apos;s signer calls the vault</b>, which pays the next withdrawal in the queue, first come first served.
          </li>
        </ol>
        <p className="sl-note">
          It costs only gas, about 0.000002 Base Sepolia ETH. The payout goes to the user waiting in the queue (our demo user), not to you: you are the
          outsider whose action triggers it.
        </p>
      </div>

      <div className="sl-card ti-act" aria-live="polite">
        <h3>Your wallet</h3>
        <div className="sl-kv">
          <span>Withdrawals waiting</span>
          <span>{queued === null ? "…" : `${queued.toString()} (each click settles one)`}</span>
        </div>

        {!checked ? null : !provider ? (
          <div className="ti-msg">
            <p>No browser wallet found. Open this page in a browser with MetaMask (or another injected wallet), or run the same steps from a terminal:</p>
            <a className="sl-btn small" href="https://github.com/isithore002/Sluice#try-it-yourself" target="_blank" rel="noreferrer">
              Command-line steps ↗
            </a>
          </div>
        ) : empty ? (
          <div className="ti-msg">
            <p>The queue is empty right now, so there is nothing to settle. The team re-arms it with a few queued withdrawals.</p>
          </div>
        ) : !account ? (
          <button className="sl-btn primary ti-go" onClick={connect} disabled={busy}>
            {step === "connecting" ? "Connecting…" : "Connect wallet"} <span aria-hidden="true">→</span>
          </button>
        ) : (
          <>
            <div className="sl-kv">
              <span>Connected</span>
              <span className="sl-mono">{short(account, 4, 4)}</span>
            </div>
            <div className="sl-kv">
              <span>Base Sepolia ETH</span>
              <span>{eth === null ? "…" : (Number(eth) / 1e18).toFixed(6)}</span>
            </div>
            {eth === 0n && (
              <p className="sl-note">
                You need a little Base Sepolia ETH for gas:{" "}
                {FAUCETS.map((f, i) => (
                  <span key={f.url}>
                    {i > 0 && " or "}
                    <a className="sl-link" href={f.url} target="_blank" rel="noreferrer">
                      {f.name}
                    </a>
                  </span>
                ))}
                .
              </p>
            )}
            <button className="sl-btn primary ti-go" onClick={settle} disabled={busy || eth === 0n}>
              {step === "connecting"
                ? "Checking your balance…"
                : step === "signing"
                ? "Confirm in your wallet…"
                : step === "mining"
                  ? "Mining your transaction…"
                  : step === "waiting"
                    ? "Waiting for Reactive…"
                    : `Repay ${usdStr(amount.toString())} mUSD for the borrower`}
            </button>
          </>
        )}

        {tx && step !== "done" && (
          <p className="sl-note">
            Your transaction:{" "}
            <a className="sl-link sl-mono" href={txUrl("base", tx)} target="_blank" rel="noreferrer">
              {short(tx, 8, 6)} ↗
            </a>
          </p>
        )}

        {outcome && (
          <div className="ti-done">
            <p className="ti-head">
              <b>✓ Reactive paid the queue {secs(outcome.afterMinedMs)} after your transaction was mined.</b>
            </p>
            <div className="sl-kv">
              <span>Paid</span>
              <span>
                {usdStr(outcome.paid.toString())} mUSD to request #{outcome.requestId.toString()}
              </span>
            </div>
            <div className="sl-kv">
              <span>Your transaction</span>
              <span>
                <a className="sl-link sl-mono" href={txUrl("base", outcome.tx)} target="_blank" rel="noreferrer">
                  {short(outcome.tx, 8, 6)} ↗
                </a>
              </span>
            </div>
            <div className="sl-kv">
              <span>Reactive&apos;s callback</span>
              <span>
                <a className="sl-link sl-mono" href={txUrl("base", outcome.callback)} target="_blank" rel="noreferrer">
                  {short(outcome.callback, 8, 6)} ↗
                </a>
              </span>
            </div>
            <div className="sl-kv">
              <span>Callback sent by</span>
              <span className={isReactiveSigner(outcome.sender) ? "ti-ok" : ""}>
                {isReactiveSigner(outcome.sender) ? "✓ Reactive's signer" : short(outcome.sender, 4, 4)}
              </span>
            </div>
            <p className="sl-note">Timed in your browser, so it includes a little polling delay.</p>
          </div>
        )}

        {error && <p className="sl-err">{error}</p>}
      </div>
    </div>
  );
}
