import PricingClient from "./PricingClient";
import { PLAN_ORDER, PLANS, ADDONS, UNIT_ADDONS } from "@/lib/plans";

export const metadata = {
  title: "Planos e Preços — LeadHub",
  description: "WhatsApp + CRM + Marketing intel num só lugar. Trial grátis de 14 dias, sem cartão.",
};

export default function PrecosPage() {
  // Plans/add-ons são definidos em src/lib/plans.ts (fonte da verdade).
  // Passamos pra UI client via props pra evitar import circular de cliente
  // pesado em rotas estáticas e permitir cache.
  const plans = PLAN_ORDER.map((tier) => PLANS[tier]);
  const enterprise = PLANS.ENTERPRISE;
  const addons = Object.values(ADDONS);
  const unitAddons = Object.values(UNIT_ADDONS);

  return (
    <PricingClient
      plans={plans}
      enterprise={enterprise}
      addons={addons}
      unitAddons={unitAddons}
    />
  );
}
