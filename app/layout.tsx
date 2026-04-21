import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlashLearn — Learn Anything, Your Way",
  description: "AI-powered adaptive flashcards that explain any topic at your level. Set your persona, choose your depth, and let the AI follow your lead.",
  keywords: ["flashcards", "AI learning", "adaptive education", "human-AI interaction", "accessibility"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <a href="#main-content" className="skip-link">Skip to main content</a>
        <main id="main-content">{children}</main>
      </body>
    </html>
  );
}