import "./globals.css";
import SiteHeader from "@/components/SiteHeader";

export const metadata = { title: "TCG Card Recognizer" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
