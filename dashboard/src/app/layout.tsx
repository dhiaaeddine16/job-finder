import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Sidebar from "@/components/Sidebar";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Upwork Scraper Analytics Dashboard",
  description: "Real-time analytics and exploration dashboard for Upwork freelance job postings.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-screen h-full">
        {/* Persistent left navigation sidebar */}
        <Sidebar />

        {/* Main scrollable content area */}
        <div className="flex-1 min-h-screen overflow-y-auto relative">
          {children}
        </div>
      </body>
    </html>
  );
}
