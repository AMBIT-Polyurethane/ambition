"use client";

// The cart lives in the browser so it survives closing the app mid-order.
export type Cart = Record<string, number>; // product id -> qty
const KEY = "ambition-cart-v1";
const EVENT = "ambition-cart";

export function readCart(): Cart {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCart(cart: Cart) {
  const clean: Cart = {};
  for (const [k, v] of Object.entries(cart)) if (v > 0) clean[k] = v;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // storage blocked (private mode): cart still works for this visit
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function cartCount(cart: Cart): number {
  return Object.values(cart).filter((v) => v > 0).length;
}

export function onCartChange(fn: () => void): () => void {
  const handler = () => fn();
  window.addEventListener(EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// The AMBIT location a staff member last ordered from, so it's marked on the "Which location?" screen.
const BRANCH_KEY = "ambition-order-branch";

export function readOrderBranch(): string | null {
  try {
    return window.localStorage.getItem(BRANCH_KEY);
  } catch {
    return null;
  }
}

export function writeOrderBranch(id: string) {
  try {
    window.localStorage.setItem(BRANCH_KEY, id);
  } catch {
    // storage blocked: nothing to remember
  }
}
