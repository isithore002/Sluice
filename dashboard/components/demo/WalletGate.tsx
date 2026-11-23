"use client";

import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useState, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useBalance, useDisconnect, useSwitchChain } from "wagmi";
import { baseSepolia } from "wagmi/chains";

const FAUCETS = [
  { name: "Coinbase Developer Platform faucet", url: "https://portal.cdp.coinbase.com/products/faucet" },
  { name: "Alchemy faucet", url: "https://www.alchemy.com/faucets/base-sepolia" },
];

/** True when the error, or any error it wraps, is the user saying no in their wallet. */
export function rejected(e: unknown): boolean {
  let x = e as { code?: number; name?: string; cause?: unknown } | undefined;
  for (let i = 0; x && i < 8; i++) {
    if (x.code === 4001 || x.name === "UserRejectedRequestError") return true;
    x = x.cause as typeof x;
  }
  return false;
}

/** A one-line, human error for a failed wallet call. */
export function errText(e: unknown): string {
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

interface GateProps {
  /** "Lender" or "Borrower": shown in the connected line so the role is always visible. */
  role: string;
  /** Rendered only when a wallet is connected on Base Sepolia and has gas. */
  children: (ctx: { address: Address; eth: bigint | null }) => ReactNode;
  /** Shown under the connected line, e.g. the role-clash warning. */
  notice?: ReactNode;
}

/**
 * Gets a visitor to "a wallet connected on Base Sepolia": our Connect button (opens RainbowKit's modal), then a
 * "Switch to Base Sepolia" button, then the gas check. Only then does it render the role's steps.
 */
export function WalletGate({ role, children, notice }: GateProps) {
  const { address, chainId, connector, status } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { disconnect } = useDisconnect();
  const balance = useBalance({ address, chainId: baseSepolia.id, query: { enabled: Boolean(address), refetchInterval: 8000 } });
  const eth = balance.data?.value ?? null;
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function switchToBase() {
    setError(null);
    setSwitching(true);
    try {
      await switchChainAsync({ chainId: baseSepolia.id });
    } catch (e) {
      setError(rejected(e) ? "You rejected the request in your wallet." : switchHelp(connector?.name));
    } finally {
      setSwitching(false);
    }
  }

  // After a reload wagmi still remembers the account while it reconnects the wallet in the background. A click in that
  // window fails ("connector.getChainId is not a function"), so the steps wait for the reconnect to finish.
  if (status === "reconnecting") {
    return (
      <div className="dm-gate">
        <p className="sl-note" aria-live="polite">
          Reconnecting your wallet…
        </p>
      </div>
    );
  }

  if (!address) {
    return (
      <div className="dm-gate">
        <ConnectButton.Custom>
          {({ openConnectModal, mounted }) => (
            <button className="sl-btn primary" onClick={openConnectModal} disabled={!mounted}>
              Connect the {role.toLowerCase()} wallet <span aria-hidden="true">→</span>
            </button>
          )}
        </ConnectButton.Custom>
      </div>
    );
  }

  // The one control kept from the old wallet header: two roles need two wallets, so switching must stay possible.
  const switchLink = (
    <button className="dm-link" onClick={() => disconnect()}>
      Use a different wallet
    </button>
  );

  if (chainId !== baseSepolia.id) {
    return (
      <div className="dm-gate">
        <p className="sl-note">Your wallet is on another network. The demo runs on Base Sepolia.</p>
        <button className="sl-btn primary" onClick={switchToBase} disabled={switching}>
          {switching ? "Switching…" : "Switch to Base Sepolia"}
        </button>
        {error && <p className="sl-err">{error}</p>}
        {switchLink}
      </div>
    );
  }

  return (
    <div className="dm-gate">
      {notice}
      {eth === 0n && (
        <p className="sl-note">
          This wallet has no Base Sepolia ETH for gas (each step costs about 0.000002):{" "}
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
      {/* No gas, no steps: a disabled fieldset disables every button and field inside it. */}
      <fieldset className="dm-gas-lock" disabled={eth === 0n}>
        {children({ address, eth })}
      </fieldset>
      {switchLink}
    </div>
  );
}
