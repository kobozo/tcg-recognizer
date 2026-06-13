import "./globals.css";

export const metadata = { title: "TCG Card Recognizer" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
