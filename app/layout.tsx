import type { Metadata } from "next";
import { Be_Vietnam_Pro, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const beVietnamPro = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800", "900"],
  variable: "--font-be-vietnam-pro",
  preload: false,
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin", "vietnamese"],
  weight: ["100", "200", "300", "400", "500", "600", "700", "800"],
  variable: "--font-jetbrains-mono",
  preload: false,
});

export const metadata: Metadata = {
  title: "Bản sao số phòng thông minh",
  description: "Bảng điều khiển Next.js cho giám sát và điều khiển phòng thông minh",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi" className={`${beVietnamPro.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <head>
        <link rel="preconnect" href="https://prod.spline.design" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="//prod.spline.design" />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
