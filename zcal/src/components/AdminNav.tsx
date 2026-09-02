"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/calendar", label: "Calendar" },
  { href: "/admin/links", label: "Booking links" },
  { href: "/admin/hours", label: "Hours & profile" },
  { href: "/admin/data", label: "Data" },
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="nav" aria-label="Owner sections">
      {LINKS.map((link) => {
        const active = link.href === "/admin" ? pathname === "/admin" : pathname.startsWith(link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="nav__link"
            aria-current={active ? "page" : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
