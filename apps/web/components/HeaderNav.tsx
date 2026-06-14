"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut } from "lucide-react";
import { buttonVariants } from "@/components/ui/Button";

type NavItem = { href: string; label: string };

export default function HeaderNav({
  isAuthed,
  isAdmin,
  email,
  logoutAction,
}: {
  isAuthed: boolean;
  isAdmin: boolean;
  email?: string | null;
  logoutAction: () => Promise<void>;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const items: NavItem[] = [
    { href: "/", label: "Home" },
    ...(isAuthed ? [{ href: "/collection", label: "My collection" }] : []),
    { href: "/scan", label: "Add card" },
    { href: "/sets", label: "Browse" },
    ...(isAdmin ? [{ href: "/admin", label: "Admin" }] : []),
    { href: "/demos", label: "Demos" },
  ];

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Desktop nav */}
        <nav className="mr-2 hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                isActive(item.href)
                  ? "bg-white/5 font-medium text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {isAuthed ? (
          <div className="hidden items-center gap-3 md:flex">
            <span className="max-w-[14rem] truncate text-sm text-muted">{email}</span>
            <form action={logoutAction}>
              <button className={buttonVariants({ variant: "outline", size: "sm" })}>
                <LogOut className="h-4 w-4" aria-hidden /> Logout
              </button>
            </form>
          </div>
        ) : (
          <div className="hidden items-center gap-2 md:flex">
            <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Login
            </Link>
            <Link href="/register" className={buttonVariants({ variant: "primary", size: "sm" })}>
              Get started
            </Link>
          </div>
        )}

        {/* Mobile toggle */}
        <button
          type="button"
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className={buttonVariants({ variant: "ghost", size: "icon", className: "md:hidden" })}
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile panel */}
      {open && (
        <div className="absolute inset-x-0 top-full border-b border-border bg-background/95 backdrop-blur-xl md:hidden">
          <nav className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4">
            {items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setOpen(false)}
                className={`rounded-lg px-3 py-2.5 text-sm ${
                  isActive(item.href)
                    ? "bg-white/5 font-medium text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {item.label}
              </Link>
            ))}
            <div className="mt-2 border-t border-border pt-3">
              {isAuthed ? (
                <form action={logoutAction}>
                  <button className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>
                    <LogOut className="h-4 w-4" aria-hidden /> Logout ({email})
                  </button>
                </form>
              ) : (
                <div className="flex flex-col gap-2">
                  <Link href="/login" onClick={() => setOpen(false)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    Login
                  </Link>
                  <Link href="/register" onClick={() => setOpen(false)} className={buttonVariants({ variant: "primary", size: "sm" })}>
                    Get started
                  </Link>
                </div>
              )}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
