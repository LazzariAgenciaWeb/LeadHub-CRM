"use client";

import { useState } from "react";

interface WebhookSettingsProps {
  companyId: string;
  webhookToken: string | null;
  baseUrl: string;
}

function downloadXlsxTemplate() {
  // Gera CSV simples que o Excel abre nativamente
  const header = "name;phone;email;source;pipeline;notes";
  const ex1 = "João Silva;5511999990001;joao@email.com;formulario-site;PROSPECCAO;Interesse no plano Pro";
  const ex2 = "Maria Souza;5521988880002;;instagram;;";
  const ex3 = "Empresa ABC;5531977770003;contato@abc.com.br;indicacao;LEADS;Orçamento solicitado";
  const csv = [header, ex1, ex2, ex3].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "modelo_importacao_leads.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function WebhookSettings({ companyId, webhookToken: initialToken, baseUrl }: WebhookSettingsProps) {
  const [token, setToken] = useState(initialToken);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedCurl, setCopiedCurl] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const webhookUrl = token ? `${baseUrl}/api/webhook/leads/${token}` : null;

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/companies/${companyId}/webhook-token`, { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      setToken(data.webhookToken);
    }
    setLoading(false);
    setConfirming(false);
  }

  async function handleRevoke() {
    setLoading(true);
    await fetch(`/api/companies/${companyId}/webhook-token`, { method: "DELETE" });
    setToken(null);
    setLoading(false);
    setConfirming(false);
  }

  function copyUrl() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function copyCurl() {
    if (!webhookUrl) return;
    const curl = `curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"João Silva","phone":"5511999990001","email":"joao@email.com","source":"formulario-site","pipeline":"PROSPECCAO","notes":"Interesse no plano Pro"}'`;
    navigator.clipboard.writeText(curl);
    setCopiedCurl(true);
    setTimeout(() => setCopiedCurl(false), 2000);
  }

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-white font-bold text-lg mb-1">Webhook de Leads</h2>
      <p className="text-slate-500 text-sm mb-6">
        Receba leads de qualquer ferramenta externa — Zapier, Make, RD Station, Google Forms, Typeform e mais.
        Cada lead enviado para este endereço entra direto no CRM.
      </p>

      {/* Token / URL */}
      <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl p-4 mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-slate-400 text-xs font-semibold uppercase tracking-wider">URL do Webhook</span>
          {token && (
            <span className="text-emerald-400 text-[11px] font-semibold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block" />
              Ativo
            </span>
          )}
        </div>

        {webhookUrl ? (
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-[#080b12] border border-[#1e2d45] rounded-lg px-3 py-2 text-xs text-indigo-300 font-mono break-all">
              {webhookUrl}
            </code>
            <button
              onClick={copyUrl}
              className="flex-shrink-0 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors"
            >
              {copied ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
        ) : (
          <p className="text-slate-600 text-sm italic">Nenhum token gerado ainda.</p>
        )}
      </div>

      {/* Ações */}
      <div className="flex gap-3 mb-8">
        {!token ? (
          <button
            onClick={handleGenerate}
            disabled={loading}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {loading ? "Gerando..." : "✨ Gerar token"}
          </button>
        ) : confirming ? (
          <div className="flex items-center gap-2">
            <span className="text-slate-400 text-sm">Tem certeza? O token atual vai parar de funcionar.</span>
            <button onClick={handleGenerate} disabled={loading} className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium disabled:opacity-50">
              {loading ? "..." : "Sim, regenerar"}
            </button>
            <button onClick={() => setConfirming(false)} className="px-3 py-1.5 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-400 text-xs hover:text-white">
              Cancelar
            </button>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={() => setConfirming(true)}
              className="px-4 py-2 rounded-lg bg-[#161f30] border border-[#1e2d45] text-slate-300 hover:text-white text-sm font-medium transition-colors"
            >
              ↻ Regenerar token
            </button>
            <button
              onClick={handleRevoke}
              disabled={loading}
              className="px-4 py-2 rounded-lg bg-red-900/30 border border-red-500/20 text-red-400 hover:text-red-300 text-sm font-medium disabled:opacity-50 transition-colors"
            >
              Revogar
            </button>
          </div>
        )}
      </div>

      {/* Campos aceitos */}
      <div className="mb-6">
        <h3 className="text-white text-sm font-semibold mb-3">Campos aceitos no JSON</h3>
        <div className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[#1e2d45]">
                <th className="text-left px-4 py-2.5 text-slate-500 font-semibold">Campo</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-semibold">Obrigatório</th>
                <th className="text-left px-4 py-2.5 text-slate-500 font-semibold">Descrição</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2d45]">
              {[
                { field: "phone / telefone", req: true,  desc: "Telefone com DDD e DDI (ex: 5511999990001)" },
                { field: "name / nome",      req: false, desc: "Nome completo ou empresa" },
                { field: "email",            req: false, desc: "E-mail de contato" },
                { field: "source / origem",  req: false, desc: "Origem do lead (ex: formulario-site, instagram)" },
                { field: "pipeline",         req: false, desc: "PROSPECCAO (padrão), LEADS ou OPORTUNIDADES" },
                { field: "notes / observacoes", req: false, desc: "Observações internas sobre o lead" },
              ].map(({ field, req, desc }) => (
                <tr key={field}>
                  <td className="px-4 py-2.5 font-mono text-indigo-300">{field}</td>
                  <td className="px-4 py-2.5">
                    <span className={req ? "text-red-400" : "text-slate-600"}>{req ? "Sim" : "Não"}</span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-400">{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Exemplo cURL */}
      {webhookUrl && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white text-sm font-semibold">Exemplo de envio (cURL)</h3>
            <button onClick={copyCurl} className="text-slate-500 hover:text-white text-xs transition-colors">
              {copiedCurl ? "✓ Copiado" : "Copiar"}
            </button>
          </div>
          <pre className="bg-[#080b12] border border-[#1e2d45] rounded-xl px-4 py-3 text-xs text-slate-300 font-mono overflow-x-auto whitespace-pre-wrap">
{`curl -X POST "${webhookUrl}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "name": "João Silva",
    "phone": "5511999990001",
    "email": "joao@email.com",
    "source": "formulario-site",
    "pipeline": "PROSPECCAO",
    "notes": "Interesse no plano Pro"
  }'`}
          </pre>
        </div>
      )}

      {/* Template de importação */}
      <div className="border border-dashed border-[#1e2d45] rounded-xl p-4">
        <div className="flex items-start gap-3">
          <span className="text-2xl">📥</span>
          <div className="flex-1">
            <p className="text-white text-sm font-semibold mb-0.5">Modelo de planilha para importação</p>
            <p className="text-slate-500 text-xs mb-3">
              Use este arquivo como base para importar leads pelo botão "Importar Leads" no CRM.
              Colunas: name, phone, email, source, pipeline, notes.
            </p>
            <button
              onClick={downloadXlsxTemplate}
              className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium transition-colors"
            >
              ⬇ Baixar modelo CSV
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
