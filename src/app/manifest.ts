import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ukingo",
    short_name: "Ukingo",
    description: "A small lodge on the edge of the Mount Kenya forest, near Nanyuki.",
    start_url: "/",
    display: "browser",
    background_color: "#101d26",
    theme_color: "#101d26",
    lang: "en-KE",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
