import Link from "next/link";
import { auth, signOut } from "@/lib/auth";
import Logo from "@/components/Logo";
import HeaderNav from "@/components/HeaderNav";

export default async function SiteHeader() {
  const session = await auth();

  async function logoutAction() {
    "use server";
    await signOut({ redirectTo: "/" });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/70 backdrop-blur-xl">
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link href="/" aria-label="TCG Recognizer home">
          <Logo />
        </Link>
        <HeaderNav
          isAuthed={Boolean(session?.user)}
          isAdmin={session?.user?.role === "ADMIN"}
          email={session?.user?.email}
          logoutAction={logoutAction}
        />
      </div>
    </header>
  );
}
