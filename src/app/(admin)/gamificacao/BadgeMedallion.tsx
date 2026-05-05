import {
  Zap, CircleCheck, DollarSign, Target, Sunrise, Sparkles,
  TrendingUp, Clock, Rocket, Activity, Crown,
  Hammer, Repeat, Sprout,
  Moon, Clover, Flame,
  Swords, Award, Shield,
  FlaskConical, Crosshair,
  Briefcase, Globe,
  type LucideIcon,
} from "lucide-react";
import { BadgeType } from "@/generated/prisma";
import {
  BADGE_META, BADGE_TIERS, BADGE_LUCIDE, TIER_HEX,
  getBadgeProgress,
} from "./labels";

const ICONS: Record<string, LucideIcon> = {
  Zap, CircleCheck, DollarSign, Target, Sunrise, Sparkles,
  TrendingUp, Clock, Rocket, Activity, Crown,
  Hammer, Repeat, Sprout,
  Moon, Clover, Flame,
  Swords, Award, Shield,
  FlaskConical, Crosshair,
  Briefcase, Globe,
};

type Props = {
  badge:    BadgeType;
  count:    number;   // número de eventos do reason base
  size?:    number;   // diâmetro (padrão 72)
};

/**
 * Medalhão circular com:
 *   - Ring SVG com gradiente que enche conforme progresso ao próximo tier
 *   - Ícone Lucide central com cor do tier (some tipo "luz acesa" no nível)
 *   - Label do tier embaixo
 *
 * Quando bloqueado: cinza com 0% de fill.
 * Quando Highlander (tier 6): pulsa.
 */
export default function BadgeMedallion({ badge, count, size = 72 }: Props) {
  const meta = BADGE_META[badge];
  const { currentTier, nextTier, progress } = getBadgeProgress(badge, count);
  const tierLevel = currentTier?.level ?? 0;
  const isMax = !nextTier && tierLevel === 6;
  const earned = !!currentTier;

  const Icon: LucideIcon = ICONS[BADGE_LUCIDE[badge]] ?? Zap;

  // Cor do tier atual (ou cinza se ainda nada conquistado)
  const tierColor = TIER_HEX[tierLevel];
  // Cor do PRÓXIMO tier (alvo do gradiente — "pra onde está aquecendo")
  const nextColor = TIER_HEX[Math.min(6, tierLevel + 1)];

  // SVG ring math
  const stroke = 6;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  // Quando isMax, ring 100%. Senão, mostra progresso ao próximo tier.
  const fillRatio = isMax ? 1 : Math.max(0, Math.min(1, progress));
  const dashOffset = circumference * (1 - fillRatio);

  const tierName = currentTier?.name ?? "Bloqueado";
  const labelLevel = earned ? `N${tierLevel}` : "—";

  // Gradient ID único pra evitar conflito quando renderiza múltiplos
  const gradId = `badge-grad-${badge}-${tierLevel}`;

  return (
    <div
      className={`flex flex-col items-center gap-1.5 ${isMax ? "animate-pulse" : ""}`}
      title={`${meta.name} · ${labelLevel} ${tierName}${
        nextTier ? ` (${count}/${nextTier.threshold} → ${nextTier.name})` : " · MAX"
      }`}
    >
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%"   stopColor={tierColor} />
              <stop offset="100%" stopColor={nextColor} />
            </linearGradient>
          </defs>
          {/* Trilho vazio */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#1e2d45"
            strokeWidth={stroke}
          />
          {/* Progresso */}
          {(earned || progress > 0) && (
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={`url(#${gradId})`}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={dashOffset}
              style={{ transition: "stroke-dashoffset 600ms ease" }}
            />
          )}
        </svg>

        {/* Ícone central com cor do tier */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            // Glow sutil que aumenta com o tier
            filter: earned ? `drop-shadow(0 0 ${4 + tierLevel * 2}px ${tierColor}80)` : "none",
          }}
        >
          <Icon
            width={size * 0.42}
            height={size * 0.42}
            stroke={earned ? tierColor : "#475569"}
            strokeWidth={2.25}
          />
        </div>
      </div>

      <div className="text-center">
        <div className={`text-[10px] font-bold uppercase tracking-wider leading-tight`}
             style={{ color: earned ? tierColor : "#475569" }}>
          {earned ? `${labelLevel} · ${tierName}` : labelLevel}
        </div>
        <div className={`text-[10px] leading-tight ${earned ? "text-white" : "text-slate-600"}`}>
          {meta.name}
        </div>
      </div>
    </div>
  );
}
