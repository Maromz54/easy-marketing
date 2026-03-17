import type { Metadata } from "next";
import { Assistant } from "next/font/google";
import { Toaster } from "@/components/ui/toaster";
import "./globals.css";

// 'Assistant' is a high-quality Hebrew & Latin font by Google Fonts
const assistant = Assistant({
  subsets: ["hebrew", "latin"],
  variable: "--font-assistant",
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "EasyMarketing - ניהול שיווק חכם",
  description: "פלטפורמת אוטומציה לשיווק - תזמון פוסטים לפייסבוק וניהול קישורים",
  keywords: ["שיווק", "פייסבוק", "אוטומציה", "תזמון פוסטים"],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // RTL: dir="rtl" + lang="he" on root html element
    <html lang="he" dir="rtl" suppressHydrationWarning>
      <body className={`${assistant.variable} font-sans antialiased bg-background text-foreground`}>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
