"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/products", label: "Products" },
  { href: "/orders", label: "Orders" },
  { href: "/api-keys", label: "API keys" },
  { href: "/api-usage", label: "API usage" },
  { href: "/docs", label: "API docs" },
];

export default function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex md:flex-col gap-1 overflow-x-auto">
      {LINKS.map((l) => {
        const active = pathname === l.href || pathname.startsWith(l.href + "/");
        return (
          <Link
            key={l.href}
            href={l.href}
            className="rounded-md px-2 py-1.5 whitespace-nowrap"
            style={active ? { background: "var(--accent)", color: "var(--accent-ink)" } : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
