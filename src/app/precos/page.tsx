import PricingClient from "./PricingClient";
import { PLAN_ORDER, PLANS, ADDONS, UNIT_ADDONS, tierAtLeast } from "@/lib/plans";

export const metadata = {
  title: "Planos e Preços — LeadHub",
  description: "WhatsApp + CRM num só lugar. Comece grátis pra sempre, sem cartão.",
};

export default function PrecosPage() {
  // Plans/add-ons são definidos em src/lib/plans.ts (fonte da verdade).
  // Passamos pra UI client via props pra evitar import circular de cliente
  // pesado em rotas estáticas e permitir cache.
  const plans = PLAN_ORDER.map((tier) => PLANS[tier]);
  const enterprise = PLANS.ENTERPRISE;
  // Só mostra add-ons contratáveis no maior plano público (ESSENCIAL). Add-ons
  // que exigem MARKETING+ ficam ocultos enquanto esses planos estão fora do ar,
  // pra não referenciar um tier que não aparece na página.
  const topPublicTier = PLAN_ORDER[PLAN_ORDER.length - 1];
  const addons = Object.values(ADDONS).filter((a) => tierAtLeast(topPublicTier, a.minTier));
  const unitAddons = Object.values(UNIT_ADDONS).filter((a) => tierAtLeast(topPublicTier, a.minTier));

  return (
    <PricingClient
      plans={plans}
      enterprise={enterprise}
      addons={addons}
      unitAddons={unitAddons}
    />
  );
}
