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

/** The MetaMask extension's provider, if injected. Phantom, Rabby and others also set isMetaMask for compatibility. */
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
 * MetaMask through its browser extension only. RainbowKit's metaMaskWallet shows a WalletConnect QR code when the
 * extension isn't installed (that needs a WalletConnect Cloud project id, or it throws "No projectId found"), and loads
 * the MetaMask SDK when it is. So unless a project id is configured, we keep RainbowKit's MetaMask entry (name, icon,
 * download links) but connect through the injected extension: a visitor without MetaMask gets "Get MetaMask" download
 * links instead of a QR code that can't connect. An installed MetaMask also announces itself over EIP-6963, and
 * RainbowKit then shows that entry under "Installed" in place of this one (same rdns, io.metamask).
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
        ...injected(
          provider
            ? { target: () => ({ id: walletDetails.rkDetails.id, name: walletDetails.rkDetails.name, provider: provider as never }) }
            : {},
        )(config),
        ...walletDetails,
      })),
  };
  return wallet;
};

// Phantom and Rabby connect only through their extensions (download links when missing). Coinbase Wallet uses its own
// SDK popup, not WalletConnect. Any other installed wallet appears under "Installed" through EIP-6963.
const wallets: WalletList = [
  {
    groupName: "Popular",
    wallets: projectId ? [metaMask, phantomWallet, coinbaseWallet, rabbyWallet, walletConnectWallet] : [metaMask, phantomWallet, coinbaseWallet, rabbyWallet],
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
