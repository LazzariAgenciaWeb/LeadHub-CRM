"use client";

import { Printer } from "lucide-react";

// Barra de ações do espelho — some na impressão (print:hidden).
// "Salvar como PDF" é o destino de impressão do navegador.
export default function PrintBar() {
  return (
    <div className="print:hidden max-w-[800px] mx-auto px-6 pt-6 flex justify-end">
      <button
        onClick={() => window.print()}
        className="flex items-center gap-2 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg px-4 py-2 transition-colors"
      >
        <Printer className="w-4 h-4" /> Imprimir / Salvar PDF
      </button>
    </div>
  );
}
