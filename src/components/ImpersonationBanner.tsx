export default function ImpersonationBanner({ companyName }: { companyName: string }) {
  return (
    <div className="bg-amber-500/15 border-b border-amber-500/30 px-4 py-2 flex items-center justify-between flex-shrink-0">
      <div className="flex items-center gap-2 text-amber-300 text-xs font-medium">
        <span>👁</span>
        <span>Visualizando como cliente: <strong>{companyName}</strong></span>
      </div>
      {/* <a> em vez de <Link>: rotas de API precisam de navegação real do browser
          para o redirect HTTP funcionar e setar/limpar o cookie de impersonação */}
      <a
        href="/api/admin/impersonate/exit"
        className="text-amber-400 text-xs font-semibold hover:text-amber-200 border border-amber-500/40 rounded px-2 py-0.5 transition-colors"
      >
        ← Voltar ao admin
      </a>
    </div>
  );
}
