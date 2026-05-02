import PricingClient from "./PricingClient";
import { PLAN_ORDER, PLANS } from "@/lib/plans";

export const metadata = {
  title: "Planos e Preços — LeadHub",
  description: "WhatsApp + CRM + Marketing intel num só lugar. Trial grátis de 14 dias, sem cartão.",
};

export default function PrecosPage() {
  // Plans são definidos em src/lib/plans.ts (fonte da verdade).
  // Passamos pra UI client via props pra evitar import circular de cliente
  // pesado em rotas estáticas e permitir cache.
  const plans = PLAN_ORDER.map((tier) => PLANS[tier]);
  const enterprise = PLANS.ENTERPRISE;

  return <PricingClient plans={plans} enterprise={enterprise} />;
}
