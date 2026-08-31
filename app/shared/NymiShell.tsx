import Link from "next/link";

export type NymiArea = "characters" | "studio" | "roteiros" | "base-dados" | "tools";

const links: Array<{ area: NymiArea; label: string; href: string; icon: string }> = [
  { area: "characters", label: "Personagens", href: "/", icon: "♙" },
  { area: "studio", label: "Studio", href: "/studio", icon: "✦" },
  { area: "roteiros", label: "Roteiros", href: "/roteiros", icon: "▤" },
  { area: "base-dados", label: "Base de dados", href: "/base%20de%20dados", icon: "▦" },
  { area: "tools", label: "Ferramentas", href: "/Ferramentas", icon: "✦" },
]; 

export function NymiBrand({ compact = false }: { compact?: boolean }) {
  return <div className={`nymi-brand ${compact ? "nymi-brand-compact" : ""}`} aria-label="Estúdio de personagens">
    <span className="nymi-brand-mark"><img src="/gacha-nymi.ico" alt="" /></span>
    <span className="nymi-brand-copy"><strong>Nymi Gacha</strong><small>CHARACTER STUDIO</small></span>
  </div>;
}

export function NymiNavigation({ active, compact = false }: { active: NymiArea; compact?: boolean }) {
  return <nav className={`nymi-navigation ${compact ? "nymi-navigation-compact" : ""}`} aria-label="Áreas principais do Nymi Gacha">
    {links.map((link) => <Link
      key={link.area}
      className={`nymi-navigation-link ${active === link.area ? "active" : ""}`}
      href={link.href}
      aria-current={active === link.area ? "page" : undefined}
    ><span aria-hidden="true">{link.icon}</span><span>{link.label}</span></Link>)}
  </nav>;
}

export function NymiConnectionStatus({ connected, detail }: { connected: boolean; detail?: string }) {
  const label = connected ? "Conectado ao PC" : "Modo de recuperação";
  return <span className={`nymi-connection-status ${connected ? "connected" : "offline"}`} role="status" title={detail || label}>
    <i aria-hidden="true" /><span>{label}</span>
  </span>;
}
