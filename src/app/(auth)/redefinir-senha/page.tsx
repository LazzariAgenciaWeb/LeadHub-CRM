import RedefinirForm from "./RedefinirForm";

export const dynamic = "force-dynamic";

export default async function RedefinirSenhaPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return <RedefinirForm token={token ?? ""} />;
}
