"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Briefcase, ListChecks, Calendar, Image as ImageIcon, X, AlertCircle } from "lucide-react";

interface UserOption { id: string; name: string }
interface SetorOption { id: string; name: string }
interface ClientOption { id: string; name: string }

export default function NewTicketForm({
  isSuperAdmin,
  companies,
  defaultCompanyId,
  categories,
  users,
  setores,
  clients,
}: {
  isSuperAdmin: boolean;
  companies: { id: string; name: string }[];
  defaultCompanyId: string;
  categories: string[];
  users: UserOption[];
  setores: SetorOption[];
  clients: ClientOption[];
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tipo do registro: SUPPORT (chamado de cliente) ou INTERNAL (tarefa)
  const [type, setType] = useState<"SUPPORT" | "INTERNAL">("SUPPORT");

  // Sugere prazo default = amanhã 17h (BRT) — facilita o atendente preencher
  const defaultDueDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(17, 0, 0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
  }, []);

  const [form, setForm] = useState({
    title: "",
    description: "",
    priority: "MEDIUM",
    category: "",
    companyId: defaultCompanyId,
    dueDate: defaultDueDate,
    assigneeId: "",
    setorId: "",
    // Cliente: pode ser id existente OU nome novo (com phone/email opcionais)
    clientCompanyId: "",
    clientCompanyName: "",
    clientCompanyPhone: "",
    clientCompanyEmail: "",
  });

  // Modo "novo cliente": quando o usuário não acha o cliente na lista
  const [newClientMode, setNewClientMode] = useState(false);

  // Anexo de imagem (base64). Mesmo padrão do WhatsApp.
  const [attachment, setAttachment] = useState<{ data: string; type: string; name: string } | null>(null);

  function pickFile(file: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Apenas imagens por enquanto.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Imagem muito grande (máx 5MB).");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // result = "data:image/png;base64,XXX..." — extrai o base64 puro
      const [header, b64] = result.split(",");
      const mime = header.match(/data:(.*);base64/)?.[1] ?? file.type;
      setAttachment({ data: b64, type: mime, name: file.name });
      setError(null);
    };
    reader.readAsDataURL(file);
  }

  // Cola imagens com Ctrl+V no body do form
  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of items) {
        if (it.type.startsWith("image/")) {
          const file = it.getAsFile();
          if (file) {
            pickFile(file);
            e.preventDefault();
            break;
          }
        }
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.title.trim() || !form.description.trim()) {
      setError("Título e descrição são obrigatórios.");
      return;
    }
    if (!form.dueDate) {
      setError("Prazo é obrigatório.");
      return;
    }

    setSaving(true);
    try {
      const payload: any = {
        type,
        title: form.title,
        description: form.description,
        priority: form.priority,
        category: form.category || null,
        companyId: form.companyId,
        dueDate: new Date(form.dueDate).toISOString(),
        assigneeId: form.assigneeId || null,
        setorId: form.setorId || null,
      };

      // Cliente só faz sentido em SUPPORT
      if (type === "SUPPORT") {
        if (newClientMode && form.clientCompanyName.trim()) {
          payload.clientCompanyName = form.clientCompanyName.trim();
          if (form.clientCompanyPhone.trim()) payload.clientCompanyPhone = form.clientCompanyPhone.trim();
          if (form.clientCompanyEmail.trim()) payload.clientCompanyEmail = form.clientCompanyEmail.trim();
        } else if (form.clientCompanyId) {
          payload.clientCompanyId = form.clientCompanyId;
        }
      }

      const res = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Falha ao abrir chamado");
        setSaving(false);
        return;
      }
      const ticket = await res.json();

      // Se há anexo, posta como mensagem adicional após criar o ticket
      if (attachment) {
        await fetch(`/api/tickets/${ticket.id}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageBody: "",
            mediaBase64: attachment.data,
            mediaType: attachment.type,
          }),
        }).catch(() => { /* não crítico */ });
      }

      router.push(`/chamados/${ticket.id}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-[#0f1623] border border-[#1e2d45] rounded-xl p-6 space-y-5">
      {/* Toggle SUPPORT / INTERNAL */}
      <div className="grid grid-cols-2 gap-2 bg-[#0a0e16] border border-[#1e2d45] rounded-lg p-1">
        <button
          type="button"
          onClick={() => setType("SUPPORT")}
          className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-semibold transition-colors ${
            type === "SUPPORT" ? "bg-blue-500/15 text-blue-300 border border-blue-500/30" : "text-slate-500 hover:text-white"
          }`}
        >
          <Briefcase className="w-4 h-4" strokeWidth={2.25} />
          Chamado de cliente
        </button>
        <button
          type="button"
          onClick={() => setType("INTERNAL")}
          className={`flex items-center justify-center gap-2 py-2 rounded-md text-sm font-semibold transition-colors ${
            type === "INTERNAL" ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "text-slate-500 hover:text-white"
          }`}
        >
          <ListChecks className="w-4 h-4" strokeWidth={2.25} />
          Tarefa interna
        </button>
      </div>

      {isSuperAdmin && (
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">
            Empresa (agência) <span className="text-red-400">*</span>
          </label>
          <select
            required
            value={form.companyId}
            onChange={(e) => setForm({ ...form, companyId: e.target.value })}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Selecione a empresa</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Cliente — só aparece em SUPPORT */}
      {type === "SUPPORT" && (
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-slate-400 text-xs font-medium">Cliente do chamado</label>
            {!newClientMode ? (
              <button
                type="button"
                onClick={() => setNewClientMode(true)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 transition-colors"
              >
                + Novo cliente
              </button>
            ) : (
              <button
                type="button"
                onClick={() => { setNewClientMode(false); setForm({ ...form, clientCompanyName: "", clientCompanyPhone: "", clientCompanyEmail: "" }); }}
                className="text-[11px] text-slate-500 hover:text-white transition-colors"
              >
                ← Escolher existente
              </button>
            )}
          </div>

          {!newClientMode ? (
            <select
              value={form.clientCompanyId}
              onChange={(e) => setForm({ ...form, clientCompanyId: e.target.value })}
              className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
            >
              <option value="">— sem cliente vinculado —</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          ) : (
            <div className="space-y-2 bg-[#0a0e16] border border-indigo-500/20 rounded-lg p-3">
              <input
                type="text"
                placeholder="Nome do cliente *"
                value={form.clientCompanyName}
                onChange={(e) => setForm({ ...form, clientCompanyName: e.target.value })}
                className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
              <div className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  placeholder="Telefone (opcional)"
                  value={form.clientCompanyPhone}
                  onChange={(e) => setForm({ ...form, clientCompanyPhone: e.target.value })}
                  className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
                <input
                  type="email"
                  placeholder="E-mail (opcional)"
                  value={form.clientCompanyEmail}
                  onChange={(e) => setForm({ ...form, clientCompanyEmail: e.target.value })}
                  className="bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
                />
              </div>
              <p className="text-[11px] text-slate-500">
                Cliente novo será criado e ficará disponível em <strong>Empresas</strong> sob a sua agência.
              </p>
            </div>
          )}
        </div>
      )}

      <div>
        <label className="block text-slate-400 text-xs font-medium mb-1.5">
          Título <span className="text-red-400">*</span>
        </label>
        <input
          type="text"
          required
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
          placeholder={type === "INTERNAL" ? "Ex: Atualizar checklist mensal" : "Descreva o problema em poucas palavras..."}
          className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">Categoria</label>
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">Sem categoria</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">Prioridade</label>
          <select
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="LOW">🟢 Baixa</option>
            <option value="MEDIUM">🟡 Média</option>
            <option value="HIGH">🟠 Alta</option>
            <option value="URGENT">🔴 Urgente</option>
          </select>
        </div>
      </div>

      {/* Prazo: linha própria com destaque, pq é obrigatório e crítico
          (sem prazo o atendente esquece de voltar). */}
      <div className="bg-amber-500/5 border border-amber-500/20 rounded-lg p-3">
        <label className="text-amber-300 text-xs font-semibold mb-1.5 flex items-center gap-1.5">
          <Calendar className="w-3.5 h-3.5" strokeWidth={2.5} />
          📅 Prazo de Encerramento <span className="text-red-400">*</span>
        </label>
        <input
          type="datetime-local"
          required
          value={form.dueDate}
          onChange={(e) => setForm({ ...form, dueDate: e.target.value })}
          className="w-full bg-[#0a0e16] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-amber-500"
        />
        <p className="text-amber-400/60 text-[11px] mt-1">
          Quando você precisa retornar ou concluir. Aparece no calendário e dispara alertas.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">Setor</label>
          <select
            value={form.setorId}
            onChange={(e) => setForm({ ...form, setorId: e.target.value })}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">— nenhum —</option>
            {setores.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-slate-400 text-xs font-medium mb-1.5">Atendente</label>
          <select
            value={form.assigneeId}
            onChange={(e) => setForm({ ...form, assigneeId: e.target.value })}
            className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
          >
            <option value="">— sem atribuição —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>{u.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-slate-400 text-xs font-medium mb-1.5">
          Descrição <span className="text-red-400">*</span>
        </label>
        <textarea
          required
          rows={5}
          value={form.description}
          onChange={(e) => setForm({ ...form, description: e.target.value })}
          placeholder={type === "INTERNAL" ? "Detalhes da tarefa..." : "Descreva o problema com o máximo de detalhes possível..."}
          className="w-full bg-[#161f30] border border-[#1e2d45] rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 resize-none"
        />
        <p className="text-[11px] text-slate-600 mt-1">Cola imagem com Ctrl+V ou anexa abaixo.</p>
      </div>

      {/* Anexo de imagem */}
      <div>
        <label className="text-slate-400 text-xs font-medium mb-1.5 flex items-center gap-1">
          <ImageIcon className="w-3 h-3" strokeWidth={2.25} />
          Anexo (opcional)
        </label>
        {!attachment ? (
          <label className="flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-[#1e2d45] rounded-lg text-slate-500 text-xs cursor-pointer hover:border-indigo-500/40 hover:text-slate-300 transition-colors">
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            <ImageIcon className="w-4 h-4" strokeWidth={2} />
            Clique pra escolher uma imagem ou cole com Ctrl+V
          </label>
        ) : (
          <div className="relative bg-[#0a0e16] border border-[#1e2d45] rounded-lg p-3 flex items-center gap-3">
            <img
              src={`data:${attachment.type};base64,${attachment.data}`}
              alt={attachment.name}
              className="w-16 h-16 object-cover rounded-md flex-shrink-0"
            />
            <div className="flex-1 min-w-0">
              <p className="text-slate-200 text-xs font-medium truncate">{attachment.name}</p>
              <p className="text-slate-600 text-[10px]">{attachment.type} · ~{Math.round(attachment.data.length * 0.75 / 1024)} KB</p>
            </div>
            <button
              type="button"
              onClick={() => setAttachment(null)}
              className="text-slate-500 hover:text-red-400 transition-colors p-1"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/25 text-red-300 text-xs">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="button"
          onClick={() => router.back()}
          className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-sm hover:text-white transition-colors"
        >
          Cancelar
        </button>
        <button
          type="submit"
          disabled={saving}
          className={`px-5 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50 transition-colors ${
            type === "SUPPORT" ? "bg-indigo-600 hover:bg-indigo-500" : "bg-emerald-600 hover:bg-emerald-500"
          }`}
        >
          {saving ? "Salvando..." : type === "SUPPORT" ? "Abrir Chamado" : "Criar Tarefa"}
        </button>
      </div>
    </form>
  );
}
