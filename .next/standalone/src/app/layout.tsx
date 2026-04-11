import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { SessionProvider } from "@/components/SessionProvider";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "LeadHub — Marketing CRM",
  description: "Gerencie leads, campanhas e WhatsApp dos seus clientes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR" className="h-full">
      <body className={`${inter.className} min-h-full bg-[#080b12] antialiased`}>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
