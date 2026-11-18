"use client";

import { useRouter } from "next/navigation";
import { Composer } from "@/components/chat/room";
import type { Staff } from "@/lib/chat";

/** Type in the order's chat right from the order (with @ to tag someone). */
export function OrderChatCompose({ roomId, me, staff, aiReady }: { roomId: string; me: { id: string; name: string }; staff: Staff[]; aiReady: boolean }) {
  const router = useRouter();
  return (
    <div className="chat2-compose">
      <Composer roomId={roomId} me={me} staff={staff} members={null} aiReady={aiReady} parent={null} placeholder="Message, or @ someone" onTyping={() => {}} onSent={async () => router.refresh()} />
    </div>
  );
}
