"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Eye } from "lucide-react";

type Props = {
  currentUserId: string;
  users: { id: string; name: string; points: number }[];
};

export default function ImpersonationViewSwitcher({ currentUserId, users }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function switchTo(userId: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (userId) params.set("asUser", userId);
    else params.delete("asUser");
    router.push(`/gamificacao?${params.toString()}`);
  }

  return (
    <div className="mb-5 bg-amber-500/5 border border-amber-500/30 rounded-xl px-4 py-3 flex items-center gap-3">
      <Eye className="w-4 h-4 text-amber-400 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-amber-200 text-xs font-medium">
          Você está em modo impersonação
        </p>
        <p className="text-amber-200/60 text-[11px] mt-0.5">
          Esses dados pessoais são do usuário selecionado da empresa, não seus.
        </p>
      </div>
      {users.length > 0 && (
        <select
          value={currentUserId}
          onChange={(e) => switchTo(e.target.value)}
          className="bg-[#080b12] border border-amber-500/30 text-amber-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400"
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name} ({u.points} pts)
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
