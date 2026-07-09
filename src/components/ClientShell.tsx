"use client";

import Link from "next/link";
import { signOut } from "next-auth/react";
import { LogOut, LayoutGrid } from "lucide-react";

/**
 * Casca da ÁREA DO CLIENTE — usada quando o usuário logado é de uma empresa
 * cliente (sub-company). Sem o menu da agência: só o espaço dele.
 */
export default function ClientShell({
  children, clientName, agencyName, banner,
}: {
  children: React.ReactNode;
  clientName: string;
  agencyName: string;
  banner?: React.ReactNode;
}) {
  return (
    <div className="csh">
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {banner}
      <header className="cshbar">
        <Link href="/meu-espaco" className="cshbrand">
          <span className="cshlogo">{(agencyName || "A").charAt(0).toUpperCase()}</span>
          <span className="cshbn">{agencyName || "Portal"}</span>
        </Link>
        <nav className="cshnav">
          <Link href="/meu-espaco" className="cshlink">Meu espaço</Link>
        </nav>
        <div className="cshright">
          <Link href="/dashboard" className="cshsys" title="Acessar o LeadHub (seus menus)">
            <LayoutGrid size={15} /> <span className="cshsyst">Acessar o sistema</span>
          </Link>
          <span className="cshclient">{clientName}</span>
          <button className="cshout" onClick={() => signOut({ callbackUrl: "/login" })} title="Sair">
            <LogOut size={15} /> <span className="cshoutt">Sair</span>
          </button>
        </div>
      </header>
      <main className="cshmain">{children}</main>
    </div>
  );
}

const CSS = `
.csh{min-height:100vh;color:#F3F5FA;
  font-family:system-ui,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;
  background:
    radial-gradient(115% 70% at 82% -12%,rgba(110,134,255,.16),transparent 58%),
    radial-gradient(90% 60% at 2% 2%,rgba(155,123,255,.12),transparent 55%),
    #06070C;}
.csh *{box-sizing:border-box}
.cshbar{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:18px;
  padding:12px 20px;background:rgba(8,9,14,.72);backdrop-filter:blur(14px);
  border-bottom:1px solid rgba(255,255,255,.08)}
.cshbrand{display:flex;align-items:center;gap:10px;text-decoration:none;color:inherit}
.cshlogo{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font-weight:800;font-size:14px;color:#fff;
  background:linear-gradient(135deg,#6E86FF,#9B7BFF);box-shadow:0 6px 16px -6px rgba(110,134,255,.7)}
.cshbn{font-size:15px;font-weight:750;letter-spacing:-.01em}
.cshnav{display:flex;gap:6px;flex:1}
.cshlink{font-size:13.5px;font-weight:600;color:#AFB6C6;text-decoration:none;padding:7px 12px;border-radius:9px}
.cshlink:hover{color:#fff;background:rgba(255,255,255,.06)}
.cshright{display:flex;align-items:center;gap:12px}
.cshsys{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:650;text-decoration:none;color:#C3CEFF;
  background:rgba(110,134,255,.12);border:1px solid rgba(110,134,255,.34);border-radius:9px;padding:7px 12px}
.cshsys:hover{background:linear-gradient(135deg,#6E86FF,#9B7BFF);color:#fff;border-color:transparent}
@media (max-width:640px){.cshsyst{display:none}}
.cshclient{font-size:13px;color:#727A8C;font-weight:600;max-width:38vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cshout{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#AFB6C6;cursor:pointer;
  background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.12);border-radius:9px;padding:7px 12px}
.cshout:hover{color:#fff;border-color:rgba(255,255,255,.22)}
@media (max-width:520px){.cshoutt{display:none}}
.cshmain{max-width:1200px;margin:0 auto;padding:24px 22px 70px}
`;
