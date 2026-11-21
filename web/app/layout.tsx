import type { Metadata } from "next";
import localFont from "next/font/local";
import { Toaster } from "sonner";
import { Hydrated } from "@/components/hydrated";
import "./globals.css";

// Self-hosted (OFL, licence beside the file), reused from the Lathar Labs console.
const sans = localFont({ src: "./fonts/hanken-grotesk-latin-wght-normal.woff2", variable: "--font-sans", weight: "100 900" });

export const metadata: Metadata = { title: { default: "Lathar Labs WhatsApp", template: "%s · Lathar Labs" } };

// Runs before paint so a saved theme never flashes the other one.
const themeScript = `try{var t=localStorage.getItem("theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${sans.variable} font-sans antialiased`}>
        {children}
        <Toaster position="bottom-right" />
        <Hydrated />
      </body>
    </html>
  );
}
