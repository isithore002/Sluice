import type { Metadata } from "next";
import "./site.css";

export const metadata: Metadata = {
  title: "Sluice",
  description: "Withdrawal queues that settle themselves, on Reactive Omni.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
