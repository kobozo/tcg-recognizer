import Link from "next/link";
import { auth, signOut } from "@/lib/auth";

export default async function SiteHeader() {
  const session = await auth();

  return (
    <header className="border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <Link href="/" className="text-lg font-bold">
          TCG Card Recognizer
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-gray-700 hover:text-blue-600">
            Home
          </Link>
          <Link href="/scan" className="text-gray-700 hover:text-blue-600">
            Scan
          </Link>
          <Link href="/account" className="text-gray-700 hover:text-blue-600">
            My scans
          </Link>
          {session?.user?.role === "ADMIN" && (
            <Link href="/admin" className="text-gray-700 hover:text-blue-600">
              Admin
            </Link>
          )}
          {session?.user ? (
            <>
              <span className="text-gray-500">{session.user.email}</span>
              <form
                action={async () => {
                  "use server";
                  await signOut({ redirectTo: "/" });
                }}
              >
                <button
                  type="submit"
                  className="rounded border border-gray-300 px-3 py-1 hover:bg-gray-100"
                >
                  Logout
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded bg-blue-600 px-3 py-1 text-white hover:bg-blue-700"
            >
              Login
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}
