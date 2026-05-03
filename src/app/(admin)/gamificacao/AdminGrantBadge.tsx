"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Award, Plus, X } from "lucide-react";
import { BadgeType } from "@/generated/prisma";
import { ALL_BADGES, BADGE_META, BADGE_TIERS } from "./labels";

type Props = {
  users: { id: string; name: string }[];
};

/** Botão flutuante + modal pra admin conceder badge manualmente. */
export default function AdminGrantBadge({ users }: Props) {
  const router = useRouter();
  const [open, setOpen]     = useState(false);
  const [userId, setUserId] = useState(users[0]?.id ?? "");
  const [badge, setBadge]   = useState<BadgeType>("RAIO_VELOZ");
  const [tier, setTier]     = useState(1);
  const [saving, setSaving] = useState(false);

  async function grant() {
    if (!userId) return;
    setSaving(true);
    await fetch("/api/admin/grant-badge", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ userId, badge, tier }),
    });
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  async function revoke() {
    if (!userId || !confirm("Remover esse tier do usuário?")) return;
    setSaving(true);
    await fetch(`/api/admin/grant-badge?userId=${userId}&badge=${badge}&tier=${tier}`, {
      method: "DELETE",
    });
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  const meta  = BADGE_META[badge];
  const tName = BADGE_TIERS[badge].find((t) => t.level === tier)?.name ?? "";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-30 px-4 py-2.5 rounded-full bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-semibold shadow-lg flex items-center gap-2 transition-colors"
      >
        <Award className="w-4 h-4" /> Conceder badge
      </button>

      {open && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0a0f1a] border border-[#1e2d45] rounded-2xl p-5 w-full max-w-md"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-white font-semibold text-sm flex items-center gap-2">
                <Award className="w-4 h-4 text-fuchsia-400" /> Conceder badge manual
              </h3>
              <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-white">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-slate-500 text-[10px] uppercase tracking-wider block mb-1">Usuário</label>
                <select
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                  className="w-full bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-fuchsia-500"
                >
                  {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-slate-500 text-[10px] uppercase tracking-wider block mb-1">Badge</label>
                <select
                  value={badge}
                  onChange={(e) => setBadge(e.target.value as BadgeType)}
                  className="w-full bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-fuchsia-500"
                >
                  {ALL_BADGES.map((b) => (
                    <option key={b} value={b}>
                      {BADGE_META[b].emoji} {BADGE_META[b].name} {BADGE_META[b].isHidden ? "🥚" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-slate-500 text-[10px] uppercase tracking-wider block mb-1">Nível (tier)</label>
                <div className="flex gap-1">
                  {BADGE_TIERS[badge].map((t) => (
                    <button
                      key={t.level}
                      onClick={() => setTier(t.level)}
                      className={`flex-1 px-2 py-1.5 text-[11px] rounded transition-colors ${
                        tier === t.level
                          ? "bg-fuchsia-500/30 text-fuchsia-100 ring-1 ring-fuchsia-500"
                          : "bg-[#080b12] text-slate-400 hover:text-white border border-[#1e2d45]"
                      }`}
                    >
                      N{t.level}
                    </button>
                  ))}
                </div>
                <p className="text-slate-600 text-[10px] mt-1">
                  {meta.emoji} {meta.name} · N{tier} {tName} · meta: {BADGE_TIERS[badge].find((t) => t.level === tier)?.threshold} eventos
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={grant}
                  disabled={saving}
                  className="flex-1 px-3 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium disabled:opacity-50"
                >
                  <Plus className="w-3 h-3 inline mr-1" /> Conceder
                </button>
                <button
                  onClick={revoke}
                  disabled={saving}
                  className="px-3 py-2 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 text-xs font-medium border border-red-500/30 disabled:opacity-50"
                >
                  Remover
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
