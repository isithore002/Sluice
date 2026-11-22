/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: the dashboard is a client-side page reading public RPCs, hostable anywhere.
  output: "export",
  images: { unoptimized: true },
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  // RainbowKit imports every wagmi connector, and their SDKs reference optional packages this site never uses: the
  // MetaMask SDK's React Native storage, WalletConnect's pretty logger, and the Coinbase CDP SDK's x402 payments
  // (reached through Base Account's Node build). Resolve them to empty modules so the build doesn't look for them.
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      "@react-native-async-storage/async-storage": false,
      "pino-pretty": false,
      "@x402/core": false,
      "@x402/evm": false,
      "@x402/extensions": false,
      "@x402/svm": false,
    };
    return config;
  },
};

export default nextConfig;
