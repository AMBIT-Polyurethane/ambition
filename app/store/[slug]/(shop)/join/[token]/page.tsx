import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { hashToken } from "@/lib/invites";
import { adcLang } from "@/lib/adc-lang";
import { pdict } from "@/lib/partner-i18n";
import { PJoinForm } from "@/components/partner/forms";

export const metadata = { title: "Set up your login" };

type Info = { email: string; partner_id: string; partner_name: string; partner_role: "owner" | "customer"; company: string | null; state: string; has_account: boolean };

/** The invite link: the store owner (invited by AMBIT) or a customer (invited by the owner) makes their login. */
export default async function PartnerJoin({ params }: { params: Promise<{ slug: string; token: string }> }) {
  const { slug, token } = await params;
  const supabase = await createClient();
  const [{ data }, { data: auth }, lang] = await Promise.all([supabase.rpc("partner_invite_lookup", { p_hash: hashToken(token) }), supabase.auth.getUser(), adcLang()]);
  const t = pdict(lang);
  const info = (Array.isArray(data) ? data[0] : data) as Info | undefined;
  const ok = info && info.partner_id === slug && info.state === "open";
  const signedInAs = auth.user?.email?.toLowerCase() ?? null;
  return (
    <div className="adc-wrap adc-pad">
      <div className="ptn-signin">
        {!ok ? (
          <>
            <div className="adc-err" role="alert">{info?.state === "used" ? t.inviteUsed : t.inviteGone}</div>
            <Link href={`/store/${slug}/signin`} className="adc-cta block">{t.goSignIn}</Link>
          </>
        ) : (
          <>
            <h1 className="adc-h1">{t.joinTitle(null)}</h1>
            <p className="adc-muted" style={{ margin: 0 }}>
              {info.partner_role === "owner" ? t.joinOwner(info.partner_name) : t.joinCustomer(info.partner_name, info.company)}
              {info.has_account ? ` ${t.joinHas}` : ""}
            </p>
            <div className="ptn-who"><span><span className="adc-sku">{t.yourLogin}</span><b>{info.email}</b></span></div>
            <PJoinForm token={token} mode={signedInAs === info.email.toLowerCase() ? "finish" : info.has_account ? "signin" : "create"} />
          </>
        )}
      </div>
    </div>
  );
}
