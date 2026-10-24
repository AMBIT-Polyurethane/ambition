import {
  Award, BookOpen, Boxes, Building2, ClipboardList, Cylinder, FileText, GraduationCap, Hammer, Headset,
  Layers, Link as LinkIcon, MapPin, Megaphone, Newspaper, Package, Phone, Plane, CirclePlay, ShieldCheck,
  ShoppingCart, Tag, TriangleAlert, Users, Video, Wrench, Calendar, Mail, CreditCard, ClipboardCheck, Truck, Droplet, Receipt, type LucideIcon,
} from "lucide-react";

export const ICONS: Record<string, LucideIcon> = {
  tag: Tag,
  plane: Plane,
  alert: TriangleAlert,
  clipboard: ClipboardList,
  megaphone: Megaphone,
  play: CirclePlay,
  video: Video,
  book: BookOpen,
  headset: Headset,
  users: Users,
  docs: FileText,
  bulletin: Newspaper,
  academy: GraduationCap,
  award: Award,
  pin: MapPin,
  phone: Phone,
  mail: Mail,
  calendar: Calendar,
  link: LinkIcon,
  cart: ShoppingCart,
  building: Building2,
  wrench: Wrench,
  hammer: Hammer,
  shield: ShieldCheck,
  box: Package,
  boxes: Boxes,
  drum: Cylinder,
  layers: Layers,
  card: CreditCard,
  form: ClipboardCheck,
  truck: Truck,
  droplet: Droplet,
  receipt: Receipt,
};

export const ICON_NAMES = Object.keys(ICONS);

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const C = ICONS[name] ?? LinkIcon;
  return <C size={size} strokeWidth={1.9} aria-hidden="true" />;
}

export function categoryIcon(categoryId: string | null | undefined): string {
  const id = (categoryId ?? "").toLowerCase();
  if (id.includes("gun-foam")) return "drum";
  if (id.includes("foam")) return "drum";
  if (id.includes("fiber") || id.includes("insul")) return "layers";
  if (id.includes("gun") || id.includes("part")) return "wrench";
  if (id.includes("ppe") || id.includes("safety") || id.includes("protective")) return "shield";
  if (id.includes("tool")) return "hammer";
  if (id.includes("coating") || id.includes("sealant") || id.includes("adhesive") || id.includes("clean")) return "drum";
  if (id.includes("plastic") || id.includes("netting") || id.includes("tape")) return "layers";
  return "box";
}
