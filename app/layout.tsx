import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlashLearnHAI",
  description: "Curiosity-driven adaptive learning — understand any topic through personalized AI flashcards, without the information overload.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}