"use client";

import { useRouter } from "next/navigation";
import { ShoppingCart } from "lucide-react";
import { readCart, writeCart } from "@/lib/cart";

/** Puts AMBIT items in the order cart (added to anything already there) and opens the order. */
export function OrderButton({ items, label, className = "btn", note }: { items: { product_id: string; qty: number }[]; label: string; className?: string; note?: string }) {
  const router = useRouter();
  const list = items.filter((i) => i.product_id && i.qty > 0);
  return (
    <span className="col tight" style={{ gap: 4 }}>
      <button
        type="button"
        className={className}
        disabled={!list.length}
        onClick={() => {
          const cart = readCart();
          for (const i of list) cart[i.product_id] = (cart[i.product_id] ?? 0) + Math.ceil(i.qty);
          writeCart(cart);
          router.push("/order");
        }}
      >
        <ShoppingCart size={16} /> {label}
      </button>
      {note ? <span className="tiny faint">{note}</span> : null}
    </span>
  );
}
