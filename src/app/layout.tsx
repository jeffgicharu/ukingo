import type { Metadata, Viewport } from "next";
import { Figtree, Instrument_Serif } from "next/font/google";

import { shareImage } from "@/lib/metadata";
import { env } from "@/server/env";

import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
  display: "swap",
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  display: "swap",
});

// Every page here is built for the person asking, at the moment they ask:
// prices, free rooms and bookings are never served from an earlier render.
export const instant = false;

// For the same reason nothing is fetched ahead of a tap. Fetching a page in
// advance for every link on screen would spend a phone's data, and the
// server's time, on pages most visitors never open.
export const prefetch = "force-disabled";

const description =
  "A small lodge on the edge of the Mount Kenya forest, 14 km from Nanyuki. Stone cottages, tents facing the peaks, and a farmhouse for eight. Check dates and book with M-Pesa.";

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: {
    default: "Ukingo · A lodge on the edge of the Mount Kenya forest, Nanyuki",
    template: "%s · Ukingo",
  },
  description,
  applicationName: "Ukingo",
  openGraph: {
    type: "website",
    siteName: "Ukingo",
    locale: "en_KE",
    title: "Ukingo · A lodge on the edge of the Mount Kenya forest",
    description,
    url: "/",
    images: [shareImage],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ukingo · A lodge on the edge of the Mount Kenya forest",
    description,
    images: [shareImage],
  },
  formatDetection: { telephone: false, date: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#101d26",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-KE" className={`${figtree.variable} ${instrumentSerif.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
