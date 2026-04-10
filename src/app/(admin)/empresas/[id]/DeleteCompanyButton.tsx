"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function DeleteCompanyButton({
  id,
  name,
}: {
  id: string;
  name: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm(`Tem certeza que deseja excluir "${name}"? Todos os dados serão apagados.`)) return;

    setLoading(true);
    await fetch(`/api/companies/${id}`, { method: "DELETE" });
    setLoading(false);
    router.push("/empresas");
    router.refresh();
  }

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      className="text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 font-semibold text-sm px-3 py-2 rounded-lg transition-colors disabled:opacity-50"
    >
      {loading ? "Excluindo..." : "Excluir"}
    </button>
  );
}
