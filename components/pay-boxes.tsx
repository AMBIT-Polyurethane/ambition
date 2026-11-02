"use client";

import { useState } from "react";

// The payment boxes accounting ticks when they release an order (0035, 0042). "Customer Has Already Paid" means
// there's nothing to collect, so it switches COD Only and No Checks Allowed off while it's ticked.

export function PayBoxes({ start, remembered }: { start: { cod: boolean; noChecks: boolean; prepaid: boolean }; remembered: boolean }) {
  const [paid, setPaid] = useState(start.prepaid);
  const [cod, setCod] = useState(start.cod);
  const [noChecks, setNoChecks] = useState(start.noChecks);
  return (
    <div className="pay-boxes">
      <label className="check small">
        <input type="checkbox" name="prepaid" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> <b>Customer Has Already Paid</b>
        <span className="tiny faint">Paid in full: nothing to collect at pickup or delivery</span>
      </label>
      <label className={`check small${paid ? " off" : ""}`}>
        <input type="checkbox" name="cod" checked={cod && !paid} disabled={paid} onChange={(e) => setCod(e.target.checked)} /> <b>COD Only</b>
        <span className="tiny faint">Payment collected at pickup or delivery</span>
      </label>
      <label className={`check small${paid ? " off" : ""}`}>
        <input type="checkbox" name="no_checks" checked={noChecks && !paid} disabled={paid} onChange={(e) => setNoChecks(e.target.checked)} /> <b>No Checks Allowed</b>
        <span className="tiny faint">Cash or card only</span>
      </label>
      {paid ? (
        <span className="tiny faint">Already paid, so COD Only and No Checks are off for this order. The customer&apos;s usual setting stays for their next order.</span>
      ) : remembered ? (
        <span className="tiny faint">Ticked the way this customer was set last time. Change them if that&apos;s different now.</span>
      ) : null}
    </div>
  );
}
