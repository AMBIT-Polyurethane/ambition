import { PProduct } from "@/components/partner/pages";

export default async function PartnerProduct({ params }: { params: Promise<{ sku: string }> }) {
  return <PProduct sku={decodeURIComponent((await params).sku)} />;
}
