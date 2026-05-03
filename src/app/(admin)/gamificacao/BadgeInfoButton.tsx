"use client";

import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";
import { BadgeType } from "@/generated/prisma";
import { BADGE_META, BADGE_TIERS, TIER_STYLES } from "./labels";

type Props = {
  badge:        BadgeType;
  count:        number;          // contagem atual (eventos)
  currentTier?: number | null;   // tier conquistado (1-6 ou null)
  reasonText?:  string;          // ex: "Tickets resolvidos"
};

export default function BadgeInfoButton({ badge, count, currentTier, reasonText }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  const meta  = BADGE_META[badge];
  const tiers = BADGE_TIERS[badge];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-5 h-5 rounded-full border border-slate-700 hover:border-slate-500 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
        title="Como conseguir"
        aria-label="Como conseguir esta conquista"
      >
        <Info className="w-3 h-3" />
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-72 z-50 bg-[#0a0f1a] border border-[#1e2d45] rounded-xl shadow-2xl p-3 text-left">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-2xl">{meta.emoji}</span>
            <div>
              <div className="text-white font-semibold text-sm">{meta.name}</div>
              <div className="text-slate-500 text-[11px]">{meta.description}</div>
            </div>
          </div>

          {reasonText && (
            <div className="text-slate-400 text-[11px] bg-[#080b12] border border-[#1e2d45] rounded px-2 py-1.5 mb-2">
              <span className="text-slate-500">Como ganha:</span> {reasonText}
            </div>
          )}

          <div className="space-y-1">
            {tiers.map((t) => {
              const unlocked = currentTier != null && t.level <= currentTier;
              const isNext   = currentTier == null ? t.level === 1 : t.level === currentTier + 1;
              const style    = TIER_STYLES[t.level];
              const remaining = t.threshold - count;
              return (
                <div
                  key={t.level}
                  className={`flex items-center justify-between text-[11px] px-2 py-1.5 rounded ${
                    unlocked ? `${style.bg} ${style.text}` : isNext ? "bg-[#080b12] ring-1 ring-fuchsia-500/30" : "bg-[#080b12]"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className={`w-5 text-center font-bold ${unlocked ? style.text : "text-slate-600"}`}>
                      N{t.level}
                    </span>
                    <span className={unlocked ? "" : isNext ? "text-fuchsia-300 font-medium" : "text-slate-500"}>
                      {t.name}
                    </span>
                  </span>
                  <span className={unlocked ? "text-slate-400" : "text-slate-600"}>
                    {unlocked ? "✓ desbloqueado"
                      : isNext ? `faltam ${Math.max(0, remaining)}`
                      : t.threshold}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
