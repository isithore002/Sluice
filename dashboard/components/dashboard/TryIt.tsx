"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useEffect, useState } from "react";
import { parseAbi, type Address, type Hex } from "viem";
import { useAccount, useBalance, useDisconnect, useSwitchChain, useWriteContract } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { vaultAbi } from "../../lib/abis";
import { addrUrl, clients, txUrl } from "../../lib/config";
import { isReactiveSigner, secs, short, usdStr } from "./format";

const oneClickAbi = parseAbi(["function settle()", "function AMOUNT() view returns (uint256)"]);
const FAUCETS = [
  { name: "Coinbase Developer Platform faucet", url: "https://portal.cdp.coinbase.com/products/faucet" },
  { name: "Alchemy faucet", url: "https://www.alchemy.com/faucets/base-sepolia" },
];
const CLI_STEPS = "https://github.com/isithore002/Sluice#try-it-yourself";

type Step = "idle" | "switching" | "signing" | "mining" | "waiting" | "done" | "error";

interface Outcome {
  tx: Hex;
  callback: Hex;
  sender: string;
  paid: bigint;
  requestId: bigint;
  afterMinedMs: number;
}

export interface TryItProps {
  addresses: Record<string, string>;
  queued: bigint | null;
}

/** True when the error, or any error it wraps, is the user saying no in their wallet. */
function rejected(e: unknown): boolean {
  let x = e as { code?: number; name?: string; cause?: unknown } | undefined;
  for (let i = 0; x && i < 8; i++) {
    if (x.code === 4001 || x.name === "UserRejectedRequestError") return true;
    x = x.cause as typeof x;
  }
  return false;
}

function errText(e: unknown): string {
  if (rejected(e)) return "You rejected the request in your wallet.";
  const err = e as { shortMessage?: string; message?: string };
  return (err?.shortMessage || err?.message || String(e)).split("\n")[0];
}

function switchHelp(walletName: string | undefined): string {
  const name = walletName || "Your wallet";
  return /phantom/i.test(name)
    ? "Phantom can't switch to Base Sepolia while its Testnet Mode is off. Turn it on in Phantom (Settings → Developer Settings → Testnet Mode) and try again, or use a different wallet."
    : `${name} couldn't switch to Base Sepolia (chain ID 84532). Add or select Base Sepolia in the wallet and try again, or use a different wallet.`;
}

/**
 * The "Try it" panel: a visitor's own wallet sends ONE transaction (OneClickRepay.settle), which repays part of the
 * demo borrower's Morpho debt. Nothing here calls Sluice: Reactive sees the repayment and pays the head of the queue.
 * The panel then finds that payout on-chain by its trace id, which is the visitor's own transaction hash.
 * Wallets connect through wagmi; "Connect wallet" opens RainbowKit's modal (see components/web3/wagmi.ts).
 */
export function TryIt({ addresses, queued }: TryItProps) {
  const oneClick = addresses.oneClickRepay as Address | undefined;
  const vault = addresses.sluiceVault as Address;
  const { address, chainId, connector, isConnected } = useAccount();
  const onBase = chainId === baseSepolia.id;
  const balance = useBalance({ address, chainId: baseSepolia.id, query: { enabled: Boolean(address) } });
  const eth = balance.data?.value ?? null;
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { disconnect } = useDisconnect();
  const [amount, setAmount] = useState<bigint>(10_000_000n);
  const [step, setStep] = useState<Step>("idle");
  const [error, setError] = useState<string | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  useEffect(() => {
    if (!oneClick) return;
    clients.base
      .readContract({ address: oneClick, abi: oneClickAbi, functionName: "AMOUNT" })
      .then(setAmount)
      .catch(() => {});
  }, [oneClick]);

  // Another account (or none) starts the panel over.
  useEffect(() => {
    setStep("idle");
    setError(null);
    setTx(null);
    setOutcome(null);
  }, [address]);

  // A network change in the wallet clears a stale "couldn't switch" message.
  useEffect(() => {
    setError(null);
    setStep((s) => (s === "error" ? "idle" : s));
  }, [chainId]);

  async function switchToBase() {
    setError(null);
    setStep("switching");
    try {
      await switchChainAsync({ chainId: baseSepolia.id });
      setStep("idle");
    } catch (e) {
      setError(rejected(e) ? "You rejected the request in your wallet." : switchHelp(connector?.name));
      setStep("error");
    }
  }

  async function settle() {
    if (!address || !oneClick) return;
    setError(null);
    setOutcome(null);
    setTx(null);
    setStep("signing");
    try {
      const hash = await writeContractAsync({ address: oneClick, abi: oneClickAbi, functionName: "settle", chainId: baseSepolia.id });
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
          void balance.refetch();
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
  const busy = step === "switching" || step === "signing" || step === "mining" || step === "waiting";

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
          <span>{queued === null ? "…" : `${queued.toString()} (each repayment pays one)`}</span>
        </div>

        {empty ? (
          <div className="ti-msg">
            <p>The queue is empty right now, so there is nothing to settle. The team re-arms it with a few queued withdrawals.</p>
          </div>
        ) : !isConnected || !address ? (
          <ConnectButton.Custom>
            {({ mounted, openConnectModal, connectModalOpen }) => (
              <>
                <button className="sl-btn primary ti-go" onClick={openConnectModal} disabled={!mounted || connectModalOpen}>
                  Connect wallet <span aria-hidden="true">→</span>
                </button>
                <p className="sl-note">
                  MetaMask, Phantom, Coinbase Wallet, Rabby or any other browser wallet. No wallet?{" "}
                  <a className="sl-link" href={CLI_STEPS} target="_blank" rel="noreferrer">
                    Run the same steps from a terminal ↗
                  </a>
                </p>
              </>
            )}
          </ConnectButton.Custom>
        ) : (
          <>
            <div className="sl-kv">
              <span>Connected</span>
              <span>
                <span className="sl-mono">{short(address, 4, 4)}</span>
                {connector ? ` · ${connector.name}` : ""}
              </span>
            </div>
            {!onBase ? (
              <>
                <p className="sl-note">Your wallet is on another network. The demo runs on Base Sepolia.</p>
                <button className="sl-btn primary ti-go" onClick={switchToBase} disabled={busy}>
                  {step === "switching" ? "Confirm in your wallet…" : "Switch to Base Sepolia"}
                </button>
              </>
            ) : (
              <>
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
                  {step === "signing"
                    ? "Confirm in your wallet…"
                    : step === "mining"
                      ? "Mining your transaction…"
                      : step === "waiting"
                        ? "Waiting for Reactive…"
                        : `Repay ${usdStr(amount.toString())} mUSD for the borrower`}
                </button>
              </>
            )}
            {!busy && (
              <button className="ti-switch" onClick={() => disconnect()}>
                Use a different wallet
              </button>
            )}
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
