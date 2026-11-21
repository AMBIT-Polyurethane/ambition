import type { Metadata } from "next";
import { adcLang } from "@/lib/adc-lang";

export const metadata: Metadata = { title: "Store policies" };

/** The short version of how ADC orders, shipping, pickup, AM-BUCKS and emails work. */
export default async function AdcPolicies() {
  const lang = await adcLang();
  const es = lang === "es";
  if (lang === "zh") return <Zh />;
  return (
    <div className="adc-wrap adc-pad">
      <article className="adc-policy">
        {es ? (
          <>
            <h1 className="adc-h1">Políticas de la tienda</h1>
            <h2>Pedidos</h2>
            <p>Un pedido en ADC es una solicitud: no cobramos nada en línea. Un miembro del equipo de AMBIT le contacta con los totales exactos (precio, envío e impuestos) antes de enviar nada. Permita hasta 4 horas para el contacto en horario de oficina. Los precios de oferta valen solo durante las fechas de la oferta.</p>
            <h2>Envío y recogida</h2>
            <p>Los estimados de envío vienen de transportistas externos y no están garantizados. Los repuestos, herramientas y suministros se envían por paquetería. La espuma en spray y las cubetas de recubrimiento se envían por flete, y nuestro equipo cotiza el flete. La fibra de vidrio es solo para recoger en una sede de AMBIT, a menos que pida un camión completo.</p>
            <h2>Espuma en spray</h2>
            <p>La espuma en spray se vende por juego: 1 lado A (ISO) + 1 lado B. El precio depende de cada cliente y se confirma por libra.</p>
            <h2>AM-BUCKS</h2>
            <p>Las cuentas de ADC ganan 3 puntos por cada $100 pagados (antes de impuestos y envío). 100 puntos = $1.00 de descuento en un pedido futuro. Los puntos se acreditan cuando el pedido está pagado, no tienen valor en efectivo, no se transfieren y AMBIT puede cambiar o terminar el programa.</p>
            <h2>Correos de ofertas</h2>
            <p>Si marca la casilla, le enviamos ofertas y productos nuevos de ADC. Puede darse de baja en cualquier momento con el enlace en cada correo o en su cuenta.</p>
            <h2 id="sms">Mensajes de texto (SMS)</h2>
            <p>AMBIT Polyurethane (AMBIT Distribution Centers) envía mensajes de texto solo a quienes marcan la casilla &ldquo;Envíenme mensajes&rdquo; al pagar, al crear una cuenta de ADC, en su cuenta de ADC o en su perfil de AMBIT Intelligence. Los mensajes son sobre sus pedidos y su cuenta: confirmaciones, aprobaciones, programación de recogidas y entregas, y avisos de la cuenta. No enviamos mensajes de mercadeo con este consentimiento.</p>
            <p>La frecuencia de los mensajes varía según sus pedidos. Pueden aplicarse tarifas de mensajes y datos. Responda <b>STOP</b> en cualquier momento para dejar de recibirlos (recibirá un mensaje de confirmación), o <b>HELP</b> para ayuda. También puede desmarcar la casilla en su cuenta, escribir a orders@ambitpu.com o llamar al 817-677-1200. Aceptar los mensajes nunca es necesario para hacer un pedido. Los operadores no son responsables de mensajes retrasados o no entregados.</p>
            <p>No vendemos, alquilamos ni compartimos su número de celular ni su consentimiento de mensajes con terceros ni afiliados para su mercadeo. Su número se usa solo para enviarle los mensajes que pidió; nuestro proveedor de mensajes los entrega por nosotros.</p>
            <h2>Su información</h2>
            <p>Usamos su nombre, correo, teléfono y dirección solo para sus pedidos, su cuenta y (si lo pidió) los correos de ofertas y los mensajes de sus pedidos. No vendemos su información y nunca compartimos números de celular ni consentimientos de mensajes con nadie para su mercadeo. ¿Preguntas? orders@ambitpu.com.</p>
          </>
        ) : (
          <>
            <h1 className="adc-h1">Store policies</h1>
            <h2>Orders</h2>
            <p>An ADC order is an order request: nothing is charged online. An AMBIT team member contacts you with exact totals (price, shipping and tax) before anything ships. Please allow up to 4 hours for contact during business hours. Sale prices apply only during the sale dates.</p>
            <h2>Shipping and pickup</h2>
            <p>Shipping estimates come from third-party carriers and are not guaranteed. Parts, tools and supplies ship by parcel. Spray foam and coating pails ship by freight, and our team quotes the freight. Fiberglass is pick up only at an AMBIT location unless you order a full truckload.</p>
            <h2>Spray foam</h2>
            <p>Spray foam is sold in sets: 1 A-side (ISO) + 1 B-side. Pricing is set for each customer and confirmed per pound.</p>
            <h2>AM-BUCKS</h2>
            <p>ADC accounts earn 3 points for every $100 paid (before tax and shipping). 100 points = $1.00 off a future order. Points post when the order is paid, have no cash value, can't be transferred, and AMBIT may change or end the program.</p>
            <h2>Deal emails</h2>
            <p>If you leave the box checked, we email you ADC deals and new products. Unsubscribe any time with the link in every email or in your account.</p>
            <h2 id="sms">Text messages (SMS)</h2>
            <p>AMBIT Polyurethane (AMBIT Distribution Centers) sends text messages only to people who tick the &ldquo;Text me&rdquo; box at checkout, when making an ADC account, in their ADC account, or in their AMBIT Intelligence profile. The texts are about your orders and account: order confirmations, approvals, pickup and delivery scheduling, and account notices. We don&apos;t send marketing texts under this consent.</p>
            <p>Message frequency varies with your orders. Message and data rates may apply. Reply <b>STOP</b> at any time to stop texts (you&apos;ll get one text confirming it), or <b>HELP</b> for help. You can also untick the box in your account, email orders@ambitpu.com or call 817-677-1200. Agreeing to texts is never required to order. Carriers are not liable for delayed or undelivered messages.</p>
            <p>We do not sell, rent or share your mobile number or your text-message consent with third parties or affiliates for their marketing. Your number is used only to send the messages you asked for; our texting provider delivers them for us.</p>
            <h2>Your information</h2>
            <p>We use your name, email, phone and address only for your orders, your account and (if you asked) deal emails and order texts. We don&apos;t sell your information, and we never share mobile numbers or text-message consent with anyone for their marketing. Questions? orders@ambitpu.com.</p>
          </>
        )}
      </article>
    </div>
  );
}

/** 中文 */
function Zh() {
  return (
    <div className="adc-wrap adc-pad">
      <article className="adc-policy" lang="zh">
        <h1 className="adc-h1">商店政策</h1>
        <h2>订单</h2>
        <p>ADC 订单是一份订单申请：网上不收取任何费用。在发货之前，AMBIT 团队成员会联系您确认准确的总额（价格、运费和税费）。工作时间内请留出最多 4 小时等待联系。促销价格仅在促销日期内有效。</p>
        <h2>运输与自提</h2>
        <p>运费估算来自第三方承运商，不作保证。配件、工具和用品通过包裹寄送。喷涂泡沫和涂料桶通过货运发送，运费由我们的团队报价。玻璃纤维仅限在 AMBIT 门店自提，整车订购除外。</p>
        <h2>喷涂泡沫</h2>
        <p>喷涂泡沫按套出售：1 个 A 料（ISO）+ 1 个 B 料。价格按客户单独设定，并按磅确认。</p>
        <h2>AM-BUCKS 积分</h2>
        <p>ADC 账户每支付 $100（不含税费和运费）可获得 3 积分。100 积分 = 下次订单减 $1.00。订单付款后积分入账；积分没有现金价值，不能转让，AMBIT 可能会更改或终止该计划。</p>
        <h2>优惠邮件</h2>
        <p>如果您保留勾选，我们会向您发送 ADC 优惠和新品邮件。您可以随时通过每封邮件中的链接或在您的账户中退订。</p>
        <h2 id="sms">短信（SMS）</h2>
        <p>AMBIT Polyurethane（AMBIT Distribution Centers）只向在结账时、创建 ADC 账户时、在 ADC 账户中或在 AMBIT Intelligence 个人资料中勾选&ldquo;短信通知&rdquo;的用户发送短信。短信内容与您的订单和账户有关：订单确认、审批、自提和送货安排以及账户通知。我们不会根据此同意发送营销短信。</p>
        <p>消息频率随您的订单而定。可能产生短信和数据费用。随时回复 <b>STOP</b> 停止接收（您会收到一条确认短信），回复 <b>HELP</b> 获取帮助。您也可以在账户中取消勾选、发送邮件至 orders@ambitpu.com 或致电 817-677-1200。下单从不要求同意接收短信。运营商不对延迟或未送达的消息负责。</p>
        <p>我们不会出售、出租或与第三方或关联方分享您的手机号码或短信同意用于其营销。您的号码仅用于发送您要求的消息；我们的短信服务商代我们发送。</p>
        <h2>您的信息</h2>
        <p>我们仅将您的姓名、邮箱、电话和地址用于您的订单、您的账户以及（如您同意）优惠邮件和订单短信。我们不会出售您的信息，也绝不会与任何人分享手机号码或短信同意用于其营销。有问题？orders@ambitpu.com。</p>
      </article>
    </div>
  );
}
