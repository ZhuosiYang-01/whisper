import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "纸条",
  description: "把一些话，留到未来抵达。",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "纸条", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#f5ead8",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
