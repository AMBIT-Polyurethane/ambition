"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle, MessagesSquare } from "lucide-react";
import { chatOrderId } from "@/app/(app)/chat/actions";

/** The little chat button on an order (in a list row or on the order): opens that order's team conversation. */
export function OrderChatButton({ orderId, count = 0, big = false }: { orderId: string; count?: number; big?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const go = async (e: React.MouseEvent | React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const r = await chatOrderId(orderId);
    if (r.ok) router.push(`/chat/${r.id}`);
    else setBusy(false);
  };
  const label = count ? `Team chat about this order (${count} message${count === 1 ? "" : "s"})` : "Team chat about this order";
  return big ? (
    <button type="button" className="btn dark block order-chat-big" onClick={go} disabled={busy}>
      {busy ? <LoaderCircle size={17} className="spin" /> : <MessagesSquare size={17} />} Team chat about this order
      <span className="tiny faint">{count ? `${count} message${count === 1 ? "" : "s"} · questions for the desk, the warehouse and the rep` : "Ask the desk, the warehouse or the rep, all in one place"}</span>
    </button>
  ) : (
    <span role="button" tabIndex={0} className={`order-chat${count ? " has" : ""}`} aria-label={label} title={label} onClick={go} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && go(e)}>
      {busy ? <LoaderCircle size={14} className="spin" /> : <MessagesSquare size={14} />}
      {count ? <b>{count}</b> : null}
    </span>
  );
}
