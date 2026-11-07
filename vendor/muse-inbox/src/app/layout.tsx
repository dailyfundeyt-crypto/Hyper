import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muse Inbox",
  description: "Aufgaben für Meta Muse",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
