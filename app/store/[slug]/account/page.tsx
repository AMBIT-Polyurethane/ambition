import { PAccount } from "@/components/partner/pages";

export const metadata = { title: "Your account" };
export default async function PartnerAccount({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  return <PAccount placed={((await searchParams).placed ?? "").slice(0, 20)} />;
}
