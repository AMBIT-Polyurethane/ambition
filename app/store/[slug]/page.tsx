import { PHome } from "@/components/partner/pages";

export default async function PartnerHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  return <PHome q={(sp.q ?? "").trim().slice(0, 80)} c={sp.c ?? ""} />;
}
