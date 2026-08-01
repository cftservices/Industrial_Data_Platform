"use client";

import Link from "next/link";

/**
 * De schermkop met een actiebalk.
 *
 * Elk scherm had tot nu toe zijn eigen losse <header> en de meeste eindigden
 * doodlopend: geen enkele uitgang behalve terug. Deze component maakt van
 * "waar kan ik vanaf hier heen" een vaste, zichtbare rij in plaats van iets dat
 * je per scherm vergeet.
 *
 * De stijl komt uit Orders.tsx, dat dit patroon al had. Twee tot vier knoppen;
 * meer maakt de kop een tweede menu en dat is de zijbalk al.
 */

export type NavLink = { href: string; label: string; title?: string };

export function HeaderLink({ href, label, title }: NavLink) {
  return (
    <Link
      href={href}
      title={title}
      className="border border-line-strong px-3 py-1.5 text-[0.8125rem] font-semibold whitespace-nowrap hover:border-ink-muted"
    >
      {label}
    </Link>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  subtitle,
  actions = [],
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle?: React.ReactNode;
  actions?: NavLink[];
  children?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3 border-b border-line-strong pb-4">
      <div className="min-w-0">
        <span className="eyebrow">{eyebrow}</span>
        <h1 className="text-[1.375rem] font-semibold tracking-[-0.015em]">{title}</h1>
        {subtitle && <span className="text-[0.8125rem] text-ink-muted">{subtitle}</span>}
      </div>
      {(actions.length > 0 || children) && (
        <div className="flex flex-wrap items-center gap-2">
          {children}
          {actions.map((a) => (
            <HeaderLink key={a.href + a.label} {...a} />
          ))}
        </div>
      )}
    </header>
  );
}

/**
 * Een doorklik in lopende tekst of in een tabelcel. Onderstreept, want in de
 * ops-familie is de accentkleur grijs: kleur alleen zou daar geen link zijn.
 * Dat is precies WCAG 1.4.1, en de reden dat dit geen kale span met kleur is.
 */
export function CrossLink({
  href,
  children,
  title,
}: {
  href: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <Link
      href={href}
      title={title}
      className="font-semibold text-accent underline underline-offset-2 hover:text-ink"
    >
      {children}
    </Link>
  );
}
