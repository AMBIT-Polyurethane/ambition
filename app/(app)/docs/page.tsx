import { requireActive } from "@/lib/session";
import { DocsList } from "@/components/docs-list";
import { TopBar } from "@/components/ui";
import type { DocumentRow } from "@/lib/types";

export const metadata = { title: "Docs" };

export default async function DocsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { supabase } = await requireActive();
  const { data } = await supabase.from("documents").select("*").eq("active", true).order("sort").order("title");
  return (
    <main className="shell">
      <TopBar title="Product docs & bulletins" />
      <DocsList docs={(data ?? []) as DocumentRow[]} initial={sp.type ?? "all"} />
    </main>
  );
}
