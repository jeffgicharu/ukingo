// The lodge described for search engines (schema.org).

import { env } from "@/server/env";

import type { Catalogue, RoomType } from "./catalogue";

const absolute = (path: string) => `${env.siteUrl}${path}`;

export function lodgeData(catalogue: Catalogue): Record<string, unknown> {
  const prices = catalogue.roomTypes.map((type) => type.fromCents / 100);
  return {
    "@context": "https://schema.org",
    "@type": "LodgingBusiness",
    "@id": absolute("/#lodge"),
    name: catalogue.settings.lodgeName,
    url: absolute("/"),
    description:
      "A small lodge on the edge of the Mount Kenya forest, 14 km from Nanyuki, with stone cottages, tents facing the peaks and a farmhouse for eight.",
    address: {
      "@type": "PostalAddress",
      addressLocality: "Nanyuki",
      addressRegion: "Laikipia County",
      addressCountry: "KE",
    },
    geo: { "@type": "GeoCoordinates", latitude: 0.05, longitude: 37.15, elevation: 2180 },
    checkinTime: "14:00",
    checkoutTime: "10:30",
    numberOfRooms: catalogue.roomTypes.reduce((sum, type) => sum + type.rooms.length, 0),
    currenciesAccepted: "KES",
    paymentAccepted: "M-Pesa",
    priceRange: `KSh ${Math.min(...prices).toLocaleString("en-KE")} to KSh ${Math.max(
      ...catalogue.roomTypes.flatMap((type) => Object.values(type.rates).map((rate) => rate.weekend / 100)),
    ).toLocaleString("en-KE")} a night`,
    amenityFeature: ["Fireplace in every room", "Restaurant", "Free parking", "Guided walks"].map((name) => ({
      "@type": "LocationFeatureSpecification",
      name,
      value: true,
    })),
  };
}

export function roomData(type: RoomType): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "HotelRoom",
    name: type.name,
    description: type.description,
    url: absolute(`/rooms/${type.slug}`),
    occupancy: { "@type": "QuantitativeValue", maxValue: type.sleeps, unitText: "guests" },
    numberOfBedrooms: type.bedrooms,
    bed: type.beds,
    ...(type.sizeSqm ? { floorSize: { "@type": "QuantitativeValue", value: type.sizeSqm, unitCode: "MTK" } } : {}),
    amenityFeature: type.features.map((name) => ({ "@type": "LocationFeatureSpecification", name, value: true })),
    containedInPlace: { "@id": absolute("/#lodge") },
    offers: {
      "@type": "Offer",
      priceCurrency: "KES",
      price: type.fromCents / 100,
      description: "Lowest price for one night, breakfast and taxes included",
      url: absolute(`/rooms/${type.slug}`),
    },
  };
}

export function trail(items: { name: string; path: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: absolute(item.path),
    })),
  };
}

export function questionData(questions: { question: string; answer: string }[]): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: questions.map((entry) => ({
      "@type": "Question",
      name: entry.question,
      acceptedAnswer: { "@type": "Answer", text: entry.answer },
    })),
  };
}
