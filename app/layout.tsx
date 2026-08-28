import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Nymi Gacha",
  description: "Estúdio local para criar e exportar personagens.",
  icons: {
    icon: "/gacha-nymi.ico",
    shortcut: "/gacha-nymi.ico",
    apple: "/gacha-nymi.ico",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
