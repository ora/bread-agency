import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Nanda Pizza - sourdough pizza for pickup",
  description:
    "Sourdough pizza for pickup in Cambridge, Massachusetts, ordered through AI agents. A demo business run by Ora for NANDA.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
