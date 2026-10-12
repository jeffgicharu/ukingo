import type { Metadata } from "next";

export const shareImage = {
  url: "/share.jpg",
  width: 1200,
  height: 630,
  alt: "Mount Kenya at first light, with the words: Where the forest ends and the mountain begins.",
};

/**
 * The search and sharing details of one page. A page that sets any sharing
 * detail replaces the whole set it inherits, so every page states all of
 * them, through here.
 */
export function describePage(page: {
  title: string;
  description: string;
  path: string;
  shareTitle?: string;
}): Metadata {
  const shareTitle = page.shareTitle ?? `${page.title} · Ukingo`;
  return {
    title: page.title,
    description: page.description,
    alternates: { canonical: page.path },
    openGraph: {
      type: "website",
      siteName: "Ukingo",
      locale: "en_KE",
      title: shareTitle,
      description: page.description,
      url: page.path,
      images: [shareImage],
    },
    twitter: {
      card: "summary_large_image",
      title: shareTitle,
      description: page.description,
      images: [shareImage],
    },
  };
}

/** For pages that belong to one person: a booking, the back office. Never listed, never shared. */
export function privatePage(title: string): Metadata {
  return {
    title,
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}
