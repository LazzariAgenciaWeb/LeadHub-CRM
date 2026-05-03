"use client";

import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Info } from "lucide-react";
import { BadgeType } from "@/generated/prisma";
import { BADGE_META, BADGE_TIERS, TIER_STYLES } from "./labels";

type Props = {
  badge:        BadgeType;
  count:        number;
  currentTier?: number | null;
  reasonText?:  string;
};

export default function BadgeInfoButton({ badge, count, currentTier, reasonText }: Props) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [mounted, setMounted] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setMounted(true); }, []);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popW = 288; // w-72
    const margin = 8;
    // Posiciona abaixo + alinhado à direita do botão por padrão
    let top  = rect.bottom + margin;
    let left = rect.right - popW;
    // Se passar do viewport à esquerda, alinha à esquerda do botão
    if (left < margin) left = rect.left;
    // Se passar do viewport embaixo, abre acima
    if (top + 400 > window.innerHeight) {
      top = rect.top - margin;
    }
    setCoords({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onScroll() { setOpen(false); }
    document.addEventListener("mousedown", onDocClick);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  const meta  = BADGE_META[badge];
  const tiers = BADGE_TIERS[badge];

  const popup = open && coords ? (
    <div
      ref={popRef}
      style={{
        position: "fixed",
        top:      `${coords.top}px`,
        left:     `${coords.left}px`,
        width:    "288px",
        zIndex:   10000,
        // Se o cálculo decidiu abrir acima, transforma origem
        transform: coords.top < (btnRef.current?.getBoundingClientRect().top ?? 0)
          ? "translateY(-100%)" : undefined,
      }}
      className="bg-[#0a0f1a] border border-[#1e2d45] rounded-xl shadow-2xl p-3 text-left"
    >
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
  ) : null;

  return (
    <>
      <button
        ref={btnRef}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        className="w-5 h-5 rounded-full border border-slate-700 hover:border-slate-500 flex items-center justify-center text-slate-500 hover:text-white transition-colors"
        title="Como conseguir"
        aria-label="Como conseguir esta conquista"
      >
        <Info className="w-3 h-3" />
      </button>
      {mounted && popup ? createPortal(popup, document.body) : null}
    </>
  );
}
