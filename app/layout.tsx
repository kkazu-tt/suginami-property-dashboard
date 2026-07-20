import type { Metadata } from "next";
import "./globals.css";

const title = "杉並ホームバリュー | パークシティ杉並 3LDK相場";
const description =
  "パークシティ杉並 セントラルタワーの3LDK参考価格と、東京23区の直近動向を毎週確認する公開ダッシュボード。";
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL ??
  "https://kkazu-tt.github.io/suginami-property-dashboard/";
const socialImage = new URL("og-public.png", siteUrl).toString();

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL(siteUrl),
  openGraph: {
    title,
    description,
    type: "website",
    locale: "ja_JP",
    images: [
      {
        url: socialImage,
        width: 1200,
        height: 630,
        alt: "パークシティ杉並 セントラルタワー 3LDK相場",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [socialImage],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
