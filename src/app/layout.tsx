import type { Metadata } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import Link from "next/link";
import SiteNav from "@/components/SiteNav";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const serif = Instrument_Serif({
  variable: "--font-instrument-serif",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Highwater",
  description:
    "Live probabilities for Gemini's daily high temperature markets, from weather observations and forecast ensembles.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${serif.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Lets reveal animations hide content only when scripts can show it again. */}
        <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('js')" }} />
      </head>
      <body className="flex min-h-full flex-col">
        <SiteNav />
        <main className="mx-auto w-full max-w-[1200px] flex-1 px-4 pb-16 sm:px-6">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <span>
              Data: Gemini Prediction Markets API, aviationweather.gov, Open-Meteo, api.weather.gov, Iowa Environmental Mesonet.
              Not financial advice.
            </span>
            <span className="flex gap-4">
              <Link href="/labs" className="hover:text-foreground">
                Labs
              </Link>
              <a href="https://github.com/VolodymyrLinuxovich/highwater" className="hover:text-foreground" target="_blank" rel="noreferrer">
                GitHub
              </a>
            </span>
          </div>
        </footer>
      </body>
    </html>
  );
}
