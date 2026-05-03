"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Edit2, Trash2, Check, X, Package } from "lucide-react";
import { formatBrazilDateTime } from "@/lib/datetime";

type Reward = {
  id:          string;
  name:        string;
  description: string | null;
  cost:        number;
  available:   boolean;
  imageUrl:    string | null;
  stock:       number | null;
};

type Redemption = {
  id:         string;
  rewardName: string;
  cost:       number;
  status:     "PENDING" | "APPROVED" | "DELIVERED" | "REJECTED";
  notes:      string | null;
  createdAt:  string | Date;
  user?:      { name: string };
};

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  PENDING:   { text: "Aguardando aprovação", color: "bg-amber-500/20 text-amber-300"   },
  APPROVED:  { text: "Aprovado",              color: "bg-blue-500/20 text-blue-300"     },
  DELIVERED: { text: "Entregue",              color: "bg-emerald-500/20 text-emerald-300" },
  REJECTED:  { text: "Recusado",              color: "bg-red-500/20 text-red-300"       },
};

export default function PremiosClient({
  rewards: initialRewards, myRedemptions, adminPending, myBalance, isAdmin,
}: {
  rewards:       Reward[];
  myRedemptions: Redemption[];
  adminPending:  Redemption[];
  myBalance:     number;
  isAdmin:       boolean;
}) {
  const router = useRouter();
  const [rewards, setRewards] = useState(initialRewards);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing]   = useState<string | null>(null);

  async function redeem(rewardId: string, cost: number) {
    if (myBalance < cost) {
      alert(`Saldo insuficiente. Você tem ${myBalance} pts, prêmio custa ${cost}.`);
      return;
    }
    if (!confirm(`Resgatar por ${cost} pts? Vai ficar pendente até admin aprovar.`)) return;
    const res = await fetch("/api/premios/resgatar", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ rewardId }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error ?? "Erro ao resgatar");
      return;
    }
    router.refresh();
  }

  async function approve(id: string, status: "APPROVED" | "DELIVERED" | "REJECTED") {
    let notes: string | null = null;
    if (status === "REJECTED") {
      notes = prompt("Motivo da recusa? (será mostrado ao usuário)") ?? "";
    }
    await fetch(`/api/premios/resgates/${id}`, {
      method:  "PATCH",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ status, notes }),
    });
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {/* Catálogo */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-white font-semibold text-sm">Catálogo</h2>
          {isAdmin && !creating && (
            <button
              onClick={() => setCreating(true)}
              className="text-xs px-3 py-1.5 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Criar prêmio
            </button>
          )}
        </div>

        {creating && (
          <RewardForm onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); router.refresh(); }} />
        )}

        {rewards.length === 0 && !creating ? (
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-8 text-center">
            <Package className="w-12 h-12 mx-auto text-slate-700 mb-2" />
            <p className="text-slate-500 text-sm">
              Nenhum prêmio cadastrado.
              {isAdmin && " Clique em 'Criar prêmio' pra começar."}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {rewards.map((r) => (
              editing === r.id ? (
                <RewardForm
                  key={r.id}
                  initial={r}
                  onCancel={() => setEditing(null)}
                  onSaved={() => { setEditing(null); router.refresh(); }}
                />
              ) : (
                <RewardCard
                  key={r.id}
                  reward={r}
                  isAdmin={isAdmin}
                  myBalance={myBalance}
                  onRedeem={() => redeem(r.id, r.cost)}
                  onEdit={() => setEditing(r.id)}
                />
              )
            ))}
          </div>
        )}
      </section>

      {/* Resgates pendentes do admin */}
      {isAdmin && adminPending.length > 0 && (
        <section>
          <h2 className="text-white font-semibold text-sm mb-3">⏳ Resgates aguardando aprovação</h2>
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl divide-y divide-[#1e2d45]">
            {adminPending.map((red) => (
              <div key={red.id} className="p-4 flex items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium">{red.rewardName}</div>
                  <div className="text-slate-500 text-xs mt-0.5">
                    {red.user?.name} · {formatBrazilDateTime(red.createdAt)} · <span className="text-amber-300 font-medium">{red.cost} pts</span>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => approve(red.id, "APPROVED")}
                    className="px-2.5 py-1 rounded bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 text-[11px] border border-blue-500/30"
                  >
                    <Check className="w-3 h-3 inline mr-0.5" /> Aprovar
                  </button>
                  <button
                    onClick={() => approve(red.id, "DELIVERED")}
                    className="px-2.5 py-1 rounded bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-300 text-[11px] border border-emerald-500/30"
                  >
                    Entregue
                  </button>
                  <button
                    onClick={() => approve(red.id, "REJECTED")}
                    className="px-2.5 py-1 rounded bg-red-500/15 hover:bg-red-500/25 text-red-300 text-[11px] border border-red-500/30"
                  >
                    <X className="w-3 h-3 inline mr-0.5" /> Recusar
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Meus resgates */}
      <section>
        <h2 className="text-white font-semibold text-sm mb-3">📜 Meus resgates</h2>
        {myRedemptions.length === 0 ? (
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-6 text-center">
            <p className="text-slate-500 text-sm">Você ainda não resgatou nenhum prêmio.</p>
          </div>
        ) : (
          <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl divide-y divide-[#1e2d45]">
            {myRedemptions.map((red) => {
              const meta = STATUS_LABEL[red.status];
              return (
                <div key={red.id} className="p-4 flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-white text-sm font-medium">{red.rewardName}</div>
                    <div className="text-slate-500 text-xs mt-0.5">
                      {formatBrazilDateTime(red.createdAt)} · <span className="text-amber-300">{red.cost} pts</span>
                    </div>
                    {red.notes && (
                      <div className="text-slate-400 text-xs mt-1 italic">"{red.notes}"</div>
                    )}
                  </div>
                  <span className={`text-[10px] uppercase tracking-wider px-2 py-1 rounded font-bold ${meta.color}`}>
                    {meta.text}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function RewardCard({
  reward, isAdmin, myBalance, onRedeem, onEdit,
}: {
  reward: Reward; isAdmin: boolean; myBalance: number;
  onRedeem: () => void; onEdit: () => void;
}) {
  const router = useRouter();
  const canAfford = myBalance >= reward.cost;
  const outOfStock = reward.stock !== null && reward.stock <= 0;

  async function disable() {
    if (!confirm("Desativar esse prêmio? Não some, mas fica indisponível pra resgate.")) return;
    await fetch(`/api/premios/${reward.id}`, { method: "DELETE" });
    router.refresh();
  }

  return (
    <div className={`bg-[#0a0f1a] border rounded-xl p-4 transition-all ${
      reward.available ? "border-[#1e2d45] hover:border-fuchsia-500/40" : "border-slate-800/50 opacity-60"
    }`}>
      <div className="flex items-start justify-between mb-2">
        <div className="text-white font-semibold text-sm">{reward.name}</div>
        {isAdmin && (
          <div className="flex gap-1">
            <button onClick={onEdit} className="text-slate-500 hover:text-white" title="Editar">
              <Edit2 className="w-3 h-3" />
            </button>
            <button onClick={disable} className="text-slate-500 hover:text-red-400" title="Desativar">
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      {reward.description && (
        <p className="text-slate-500 text-xs mb-3">{reward.description}</p>
      )}
      <div className="flex items-center justify-between mt-auto">
        <div className="text-amber-300 font-bold text-base">{reward.cost} pts</div>
        {reward.stock !== null && (
          <div className="text-slate-600 text-[10px]">{reward.stock} restantes</div>
        )}
      </div>
      {!reward.available && <div className="mt-2 text-[10px] text-slate-600">Indisponível</div>}
      {reward.available && (
        <button
          onClick={onRedeem}
          disabled={!canAfford || outOfStock}
          className={`mt-3 w-full px-3 py-1.5 rounded text-xs font-medium transition-colors ${
            canAfford && !outOfStock
              ? "bg-emerald-600 hover:bg-emerald-500 text-white"
              : "bg-[#080b12] text-slate-600 cursor-not-allowed border border-[#1e2d45]"
          }`}
        >
          {outOfStock ? "Sem estoque" : !canAfford ? `Faltam ${reward.cost - myBalance} pts` : "Resgatar"}
        </button>
      )}
    </div>
  );
}

function RewardForm({
  initial, onCancel, onSaved,
}: {
  initial?: Reward;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name:        initial?.name ?? "",
    description: initial?.description ?? "",
    cost:        initial?.cost ?? 100,
    stock:       initial?.stock ?? null as number | null,
    available:   initial?.available ?? true,
  });
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const url    = initial ? `/api/premios/${initial.id}` : "/api/premios";
    const method = initial ? "PATCH" : "POST";
    await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(form),
    });
    setSaving(false);
    onSaved();
  }

  return (
    <div className="bg-[#080b12] border-2 border-fuchsia-500/40 rounded-xl p-4 space-y-2 col-span-full">
      <input
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        placeholder="Nome do prêmio (ex: Vale-cinema)"
        className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded px-3 py-2 text-sm text-white"
      />
      <textarea
        value={form.description ?? ""}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        rows={2}
        placeholder="Descrição (opcional)"
        className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded px-3 py-2 text-sm text-white resize-none"
      />
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-slate-500 text-[10px] uppercase tracking-wider block mb-1">Custo (pts)</label>
          <input
            type="number"
            value={form.cost}
            onChange={(e) => setForm({ ...form, cost: parseInt(e.target.value) || 0 })}
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded px-3 py-2 text-sm text-white"
          />
        </div>
        <div>
          <label className="text-slate-500 text-[10px] uppercase tracking-wider block mb-1">Estoque (vazio = ilimitado)</label>
          <input
            type="number"
            value={form.stock ?? ""}
            onChange={(e) => setForm({ ...form, stock: e.target.value ? parseInt(e.target.value) : null })}
            className="w-full bg-[#0a0f1a] border border-[#1e2d45] rounded px-3 py-2 text-sm text-white"
          />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-slate-400">
        <input
          type="checkbox"
          checked={form.available}
          onChange={(e) => setForm({ ...form, available: e.target.checked })}
          className="w-4 h-4 rounded accent-fuchsia-500"
        />
        Disponível pra resgate
      </label>
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || !form.name.trim() || form.cost <= 0}
          className="flex-1 px-3 py-2 rounded bg-fuchsia-600 hover:bg-fuchsia-500 text-white text-xs font-medium disabled:opacity-50"
        >
          {saving ? "Salvando..." : initial ? "Salvar" : "Criar"}
        </button>
        <button onClick={onCancel} className="px-3 py-2 text-slate-400 hover:text-white text-xs">
          Cancelar
        </button>
      </div>
    </div>
  );
}
