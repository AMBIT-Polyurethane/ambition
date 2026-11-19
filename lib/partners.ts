// Partner stores: a copy of the ADC web store branded for a distributor AMBIT works with (their logo, colors and
// customers). Preview only for now: what a partner's customers and staff do is kept in the browser of whoever is
// trying it, so nothing reaches AMBIT's orders, customers or prices.

export type PartnerCustomer = {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  city: string;
  terms: string;
  /** % off the store price on everything, before any item price set for them. */
  off: number;
};

export type Partner = {
  slug: string;
  name: string;
  short: string;
  logo: string;
  /** Header and buttons. */
  color: string;
  /** Hover and accents. */
  color2: string;
  tagline: string;
  heroTitle: string;
  heroText: string;
  phone: string;
  email: string;
  city: string;
  /** AMBIT drop-ships items whose category has one of these words through this partner (gun parts). */
  dropshipWords: string[];
  customers: PartnerCustomer[];
};

const CFS: Partner = {
  slug: "cfs",
  name: "Contractors Foam Supply",
  short: "CFS",
  logo: "/partners/cfs/logo.png",
  color: "#2d694b",
  color2: "#24563d",
  tagline: "Spray foam rig parts, guns and supplies",
  heroTitle: "Every part your rig needs, in stock and ready to ship.",
  heroText: "Guns, parts, hoses and supplies for spray foam contractors. Sign in for your account pricing and your order history.",
  phone: "(555) 010-2400",
  email: "orders@example.com",
  city: "Preview store",
  dropshipWords: ["gun", "part", "hose", "tip", "chamber", "seal", "kit"],
  customers: [
    { id: "c1", company: "Red Rock Spray Foam", contact: "Cody Harmon", email: "cody@example.com", phone: "(555) 010-1101", city: "Ada, OK", terms: "Net 30", off: 10 },
    { id: "c2", company: "Prairie Insulation Co.", contact: "Dana Whitfield", email: "dana@example.com", phone: "(555) 010-1102", city: "Wichita, KS", terms: "Net 15", off: 5 },
    { id: "c3", company: "Summit Coatings", contact: "Luis Ortega", email: "luis@example.com", phone: "(555) 010-1103", city: "Amarillo, TX", terms: "Card on file", off: 0 },
  ],
};

export const PARTNERS: Partner[] = [CFS];
export const partnerBySlug = (slug: string) => PARTNERS.find((p) => p.slug === slug) ?? null;
