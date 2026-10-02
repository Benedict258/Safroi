import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Green Corner Quote Tool", template: "%s | Green Corner Quotes" },
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
