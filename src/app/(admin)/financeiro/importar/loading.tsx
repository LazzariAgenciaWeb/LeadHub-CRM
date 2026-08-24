/**
 * Rede de segurança para navegação direta (link colado, recarregar a página
 * com ?previa=1). Na navegação por clique quem dá o retorno é o useTransition
 * do botão — search param que muda nem sempre remonta o segmento, então um
 * dos dois sozinho não cobre os dois casos.
 */
export default function Loading() {
  return (
    <div className="p-6 space-y-5">
      <div className="h-6 w-72 rounded bg-white/5 animate-pulse" />
      <div className="h-4 w-96 rounded bg-white/5 animate-pulse" />
      <div className="h-24 rounded-xl bg-[#0f1623] border border-[#1e2d45] animate-pulse" />
      <p className="text-sm text-slate-500">Lendo os contratos no ClickUp…</p>
    </div>
  );
}
