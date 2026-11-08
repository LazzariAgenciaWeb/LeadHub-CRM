"use client";

import Script from "next/script";

// Pixel da Meta só no cadastro: PageView ao abrir e "CompleteRegistration"
// quando a conta é criada (ver ComecarForm). É o evento que a campanha do
// GoHub otimiza. O id vem do servidor (META_PIXEL_GOHUB).

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export default function MetaPixel({ pixelId }: { pixelId: string }) {
  if (!/^\d{6,20}$/.test(pixelId)) return null;
  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pixelId}');fbq('track','PageView');`}
    </Script>
  );
}

/** Dispara o cadastro concluído e dá um respiro pro pixel enviar antes de sair da página. */
export async function trackSignup(plan: string | null): Promise<void> {
  if (typeof window === "undefined" || !window.fbq) return;
  window.fbq("track", "CompleteRegistration", { content_name: plan ?? "gratis", currency: "BRL", value: 0 });
  await new Promise((r) => setTimeout(r, 400));
}
