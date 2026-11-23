import { connectorsForWallets, darkTheme, type Theme, type Wallet, type WalletList } from "@rainbow-me/rainbowkit";
import { coinbaseWallet, metaMaskWallet, phantomWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { createConfig, createConnector, http } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { injected } from "wagmi/connectors";
import { CHAINS } from "../../lib/config";

type CreateWalletFn = WalletList[number]["wallets"][number];

/** WalletConnect Cloud project id, read at build time. Without one, the modal offers only browser wallets. */
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim() ?? "";

interface InjectedFlags {
  isMetaMask?: boolean;
  isPhantom?: boolean;
  isRabby?: boolean;
  isBraveWallet?: boolean;
  isCoinbaseWallet?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  isOkxWallet?: boolean;
  providers?: InjectedFlags[];
}

/** Set once createConfig returns. Read through this (never through wagmiConfig itself) so nothing touches the config before it exists. */
let configRef: ReturnType<typeof createConfig> | undefined;

/** The MetaMask extension's provider from window.ethereum, if present. Phantom, Rabby and others also set isMetaMask for compatibility. */
function injectedMetaMask(): InjectedFlags | undefined {
  if (typeof window === "undefined") return undefined;
  const eth = (window as unknown as { ethereum?: InjectedFlags }).ethereum;
  if (!eth) return undefined;
  const candidates = eth.providers?.length ? eth.providers : [eth];
  return candidates.find(
    (p) => p.isMetaMask && !p.isPhantom && !p.isRabby && !p.isBraveWallet && !p.isCoinbaseWallet && !p.isTrust && !p.isTrustWallet && !p.isOkxWallet,
  );
}

/**
 * The real MetaMask provider, looked up at connect time (never at config time: other wallets take over window.ethereum after
 * this module loads, and some set isMetaMask themselves). EIP-6963 is authoritative: MetaMask announces itself as io.metamask.
 * window.ethereum is only a fallback for wallet-flag detection, and never returns Phantom or another wallet.
 */
function metaMaskProvider(): unknown {
  // configRef is set right after createConfig below. wagmi may call a connector target while the config is still being built, when it is not set yet.
  const announced = configRef?._internal.mipd?.findProvider({ rdns: "io.metamask" })?.provider;
  return announced ?? injectedMetaMask();
}

/**
 * MetaMask through its browser extension only. RainbowKit's metaMaskWallet shows a WalletConnect QR code when the
 * extension isn't installed (that needs a WalletConnect Cloud project id, or it throws "No projectId found"), and loads
 * the MetaMask SDK when it is. So unless a project id is configured, we keep RainbowKit's MetaMask entry (name, icon,
 * download links) but connect through the injected extension: a visitor without MetaMask gets "Get MetaMask" download
 * links instead of a QR code that can't connect. An installed MetaMask also announces itself over EIP-6963, and
 * RainbowKit then shows that entry under "Installed" in place of this one (same rdns, io.metamask).
 *
 * The connector always has an explicit target, so when no real MetaMask provider exists wagmi reports "provider not found"
 * instead of falling back to window.ethereum, which would silently open whichever other wallet owns it (Phantom).
 */
const metaMask: CreateWalletFn = (params) => {
  const provider = injectedMetaMask();
  if (projectId && !provider) return metaMaskWallet(params); // QR code and mobile deep link through WalletConnect
  const rk = metaMaskWallet({ ...params, projectId: params.projectId || "unused" }); // borrowed for its metadata only
  const wallet: Wallet = {
    ...rk,
    installed: Boolean(provider),
    qrCode: undefined,
    mobile: undefined,
    createConnector: (walletDetails) =>
      createConnector((config) => ({
        ...injected({
          target: () => ({ id: walletDetails.rkDetails.id, name: walletDetails.rkDetails.name, provider: (() => metaMaskProvider()) as never }),
        })(config),
        ...walletDetails,
      })),
  };
  return wallet;
};

/** The provider a wallet announced over EIP-6963 (looked up when called, after wagmiConfig exists). */
const announced = (rdns: string): unknown => configRef?._internal.mipd?.findProvider({ rdns })?.provider;

/**
 * RainbowKit builds Phantom's and Rabby's connectors from a provider it finds once, at load. When that lookup comes back empty
 * it hands wagmi an empty injected config, and wagmi then connects to window.ethereum, which is whichever wallet owns it (so
 * "Rabby" or "Phantom" could open MetaMask). Same fix as MetaMask: look the wallet up at connect time, EIP-6963 first, and
 * always give wagmi an explicit target, so a wallet that isn't there fails with "provider not found" instead.
 */
function strictInjected(make: CreateWalletFn, rdns: string, fallback: () => unknown): CreateWalletFn {
  return (params) => {
    const rk = make(params);
    return {
      ...rk,
      createConnector: (walletDetails) =>
        createConnector((config) => ({
          ...injected({
            target: () => ({ id: walletDetails.rkDetails.id, name: walletDetails.rkDetails.name, provider: (() => announced(rdns) ?? fallback()) as never }),
          })(config),
          ...walletDetails,
        })),
    };
  };
}

type EthWindow = { ethereum?: InjectedFlags & { providers?: (InjectedFlags & Record<string, unknown>)[] }; phantom?: { ethereum?: unknown } };
const win = (): EthWindow | undefined => (typeof window === "undefined" ? undefined : (window as unknown as EthWindow));
const phantom = strictInjected(phantomWallet, "app.phantom", () => win()?.phantom?.ethereum);
const rabby = strictInjected(rabbyWallet, "io.rabby", () => {
  const eth = win()?.ethereum;
  return (eth?.providers?.length ? eth.providers : eth ? [eth] : []).find((p) => p.isRabby);
});

// Phantom and Rabby connect only through their extensions (download links when missing). Coinbase Wallet uses its own
// SDK popup, not WalletConnect. Any other installed wallet appears under "Installed" through EIP-6963.
const wallets: WalletList = [
  {
    groupName: "Popular",
    wallets: projectId ? [metaMask, phantom, coinbaseWallet, rabby, walletConnectWallet] : [metaMask, phantom, coinbaseWallet, rabby],
  },
];

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: connectorsForWallets(wallets, { appName: "Sluice", projectId: projectId || "unused" }),
  transports: { [baseSepolia.id]: http(CHAINS.base.rpc) },
  // The panel only ever renders in the browser, but with ssr: false wagmi reconnects a remembered wallet during render,
  // which React flags as a state update inside another component's render. ssr: true defers it to an effect.
  ssr: true,
});
configRef = wagmiConfig;

// Some wallets (Phantom is one) announce themselves over EIP-6963 twice in the same batch. wagmi checks each announcement against the
// connectors it already has, but not against the others in that batch, so both get registered and RainbowKit then renders two entries
// with the same key ("app.phantom"). Keep the first connector for each id.
if (typeof window !== "undefined") {
  const store = wagmiConfig._internal.connectors;
  store.subscribe((connectors) => {
    const seen = new Set<string>();
    const unique = connectors.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
    if (unique.length !== connectors.length) store.setState(unique);
  });
}

const dark = darkTheme({ accentColor: "#8b5cf6", accentColorForeground: "#ffffff", borderRadius: "large", fontStack: "system", overlayBlur: "small" });

/** RainbowKit's dark theme, recoloured with the site's tokens (site.css: --surface, --line, --ink, --ink-2, --muted). */
export const sluiceTheme: Theme = {
  ...dark,
  colors: {
    ...dark.colors,
    modalBackground: "#0b0d14",
    modalBorder: "rgba(255, 255, 255, 0.09)",
    generalBorder: "rgba(255, 255, 255, 0.09)",
    modalText: "#eef0f6",
    modalTextSecondary: "#aab0bf",
    modalTextDim: "#7d8393",
    modalBackdrop: "rgba(5, 6, 10, 0.72)",
    menuItemBackground: "rgba(255, 255, 255, 0.06)",
  },
  fonts: { body: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
};
