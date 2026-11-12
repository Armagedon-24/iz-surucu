import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { PwaRegister } from "@/components/pwa-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "İzSürücü — Adli Belge İnceleme Konsolu",
  description:
    "Karalanmış yazılarda gerçeği keşfedin. Kamera ile belge fotoğrafı çekin; UV ve kızılötesi sanal bantlarla kimyasal silme ve tahrip izlerini görünür kılın, OCR ile metni okuyun, yapay zekâ destekli adli analiz raporu alın.",
  keywords: [
    "adli belge inceleme", "forensic document examination", "OCR", "UV bant",
    "kızılötesi", "silme tespiti", "kimyasal tahrip", "CLAHE", "Sauvola",
  ],
  authors: [{ name: "İzSürücü" }],
  manifest: "/manifest.webmanifest",
  applicationName: "İzSürücü",
  appleWebApp: {
    capable: true,
    title: "İzSürücü",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    title: "İzSürücü — Adli Belge İnceleme Konsolu",
    description:
      "Karalanmış yazılarda gerçeği keşfedin — sanal spektral bantlar, OCR ve yapay zekâ ile belge tahrip analizi.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0c0a",
  width: "device-width",
  initialScale: 1,
  // hassas bölge seçimi/kaydırma jestleri sayfa yakınlaştırmasıyla çakışmasın
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="tr" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <PwaRegister />
      </body>
    </html>
  );
}
