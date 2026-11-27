"use client";

import { createContext, useContext } from "react";

// The signed-in shopper's real prices for Graco and Binks parts (public pages show MSRP only). Empty for guests.
export type MyPrices = { signedIn: boolean; prices: Record<string, { price: number; sale: boolean }> };
const Ctx = createContext<MyPrices>({ signedIn: false, prices: {} });

export function AdcMyPricesProvider({ value, children }: { value: MyPrices; children: React.ReactNode }) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useMyPrices = () => useContext(Ctx);
