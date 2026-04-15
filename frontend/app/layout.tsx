import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ToastProvider } from "@/hooks/use-toast";
import { ToastProvider as RadixToastProvider } from "@/components/ui/toast";
import { Toaster } from "@/components/ui/toaster";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist-sans",
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "latin-ext"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "HIT.GUESS.",
  description: "Daily music guessing game (TidalGuess).",
  openGraph: {
    locale: "pl_PL",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body
        className={`${inter.variable} ${jetbrainsMono.variable} min-h-0 bg-[#EBE7DF] font-sans antialiased`}
      >
        <ToastProvider>
          <RadixToastProvider swipeDirection="right">
            {children}
            <Toaster />
          </RadixToastProvider>
        </ToastProvider>
      </body>
    </html>
  );
}
