import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import UnsubscribeClient from "./UnsubscribeClient";

// Página pública (sem auth) de descadastro.
// Carrega só os dados necessários, deixa a confirmação pra UnsubscribeClient.
export default async function UnsubscribePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const recipient = await prisma.emailRecipient.findUnique({
    where: { token },
    select: {
      email: true,
      campaign: { select: { company: { select: { name: true } } } },
    },
  });

  if (!recipient) notFound();

  return (
    <UnsubscribeClient
      token={token}
      email={recipient.email}
      companyName={recipient.campaign.company.name}
    />
  );
}
