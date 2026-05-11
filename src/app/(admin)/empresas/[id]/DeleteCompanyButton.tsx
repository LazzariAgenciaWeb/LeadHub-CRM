"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import DeleteMergeModal from "../DeleteMergeModal";

interface Props {
  id: string;
  name: string;
  counts: {
    leads: number;
    campaigns: number;
    whatsappInstances: number;
    subCompanies: number;
  };
  // Empresas elegíveis pro merge (mesmo parent, fora a própria).
  // SUPER_ADMIN: todas as outras. ADMIN: as outras sub-empresas do mesmo parent.
  eligibleTargets: { id: string; name: string }[];
}

export default function DeleteCompanyButton({ id, name, counts, eligibleTargets }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="text-red-400 bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 font-semibold text-sm px-3 py-2 rounded-lg transition-colors"
      >
        🗑️ Excluir
      </button>
      {open && (
        <DeleteMergeModal
          target={{ id, name, _count: counts }}
          eligibleTargets={eligibleTargets}
          open={open}
          onClose={() => setOpen(false)}
          onDeleted={() => {
            router.push("/empresas");
            router.refresh();
          }}
          onMerged={() => router.refresh()}
        />
      )}
    </>
  );
}
