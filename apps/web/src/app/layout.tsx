import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/lib/providers";

export const metadata: Metadata = {
  title: "GodsView",
  description: "Multi-agent trading intelligence — v2 command center",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
