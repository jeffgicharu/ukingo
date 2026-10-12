// The lodge as it is first set up: rooms, prices, rules and the words on the
// site. `pnpm db:seed` writes this to an empty database. After that, staff
// change these things in the back office and the database is the truth.

import { shillings } from "@/lib/format";

export const settings = {
  lodgeName: "Ukingo",
  place: "Nanyuki, Kenya",
  checkInFrom: "2 pm",
  checkOutBy: "10.30 am",
  holdMinutes: 15,
  provisionalHours: 24,
  depositPercent: 30,
  balanceDueDays: 14,
  changeUntilDays: 7,
  cancellationSteps: [
    { min_days: 30, keep_percent: 0 },
    { min_days: 14, keep_percent: 30 },
    { min_days: 0, keep_percent: 100 },
  ],
  bookingWindowMonths: 12,
  sameDayUntilHour: 16,
  maxNights: 14,
};

export const roomTypes = [
  {
    slug: "forest-cottage",
    name: "Forest Cottage",
    tagline: "A stone cottage under the cedars, with its own fire.",
    description:
      "Five cottages stand along the tree line, each far enough from the next that you hear the forest and not your neighbours. Inside there is a king bed facing a stone fireplace, laid every afternoon and lit before you come back from dinner. The veranda looks straight into the cedars, where colobus monkeys cross most mornings.",
    sleeps: 2,
    bedrooms: 1,
    beds: "One king bed",
    sizeSqm: 38,
    features: [
      "Stone fireplace, laid daily",
      "Veranda facing the forest",
      "Rain shower with solar-heated water",
      "Writing desk",
      "Hot-water bottles at turn-down",
      "Tea and coffee tray",
    ],
    rooms: ["Cedar", "Olive", "Fig", "Croton", "Hagenia"],
  },
  {
    slug: "mountain-tent",
    name: "Mountain Tent",
    tagline: "Canvas on a raised deck, with the peaks at the foot of the bed.",
    description:
      "Four tents sit on timber decks at the top of the meadow, where the ground opens towards Mount Kenya. On a clear morning you can watch the sun reach Batian from your pillow. Each tent has a proper bed, a wood stove, and a bathroom built in stone behind the canvas, so nights are warm even when there is frost on the grass.",
    sleeps: 2,
    bedrooms: 1,
    beds: "One king bed or two singles",
    sizeSqm: 32,
    features: [
      "Deck facing Mount Kenya",
      "Wood stove",
      "Stone bathroom with a hot shower",
      "Outdoor bathtub on the deck",
      "Hot-water bottles at turn-down",
      "Tea and coffee tray",
    ],
    rooms: ["Batian", "Nelion", "Lenana", "Sendeyo"],
  },
  {
    slug: "family-cottage",
    name: "Family Cottage",
    tagline: "Two bedrooms, one fire, and a lawn to run on.",
    description:
      "The two family cottages are set beside the meadow, close to the main house and away from the stream. Each has a main bedroom with a king bed, a second bedroom with two singles, and a sitting room between them with a fireplace and a table big enough for a board game. Children's supper can be served early in the cottage.",
    sleeps: 4,
    bedrooms: 2,
    beds: "One king bed and two singles",
    sizeSqm: 64,
    features: [
      "Two bedrooms and a sitting room",
      "Fireplace, laid daily",
      "Two bathrooms",
      "Veranda onto the meadow",
      "Early supper for children",
      "Cot on request",
    ],
    rooms: ["Sirimon", "Chogoria"],
  },
  {
    slug: "ukingo-house",
    name: "Ukingo House",
    tagline: "The whole house, for eight, with its own cook.",
    description:
      "The old farmhouse at the edge of the property is booked whole. It has four bedrooms, a long dining table, a sitting room with a fireplace you can stand in, and a fire pit on the lawn. A cook and a housekeeper look after the house, and meals are served when and where you like. It suits two families or a group of friends.",
    sleeps: 8,
    bedrooms: 4,
    beds: "Two king beds and four singles",
    sizeSqm: 210,
    features: [
      "Four bedrooms, three bathrooms",
      "Your own cook and housekeeper",
      "Sitting room with a large fireplace",
      "Fire pit on the lawn",
      "Private garden",
      "Dining table for ten",
    ],
    rooms: ["Ukingo House"],
  },
] as const;

export const seasons = [
  { code: "mid", name: "Mid season", isDefault: true },
  { code: "low", name: "Green season", isDefault: false },
  { code: "high", name: "High season", isDefault: false },
] as const;

type SeasonCode = (typeof seasons)[number]["code"];

/** Easter Sunday, by the usual computus. Easter weekend is priced as high season. */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function shift(date: Date, days: number): string {
  return iso(new Date(date.getTime() + days * 86_400_000));
}

/** Season date ranges for a run of years. `to` is the morning after the last night. */
export function seasonDates(fromYear: number, toYear: number) {
  const ranges: { season: SeasonCode; from: string; to: string; label: string }[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const easter = easterSunday(year);
    const goodFriday = shift(easter, -2);
    const easterTuesday = shift(easter, 2);

    // The long rains, less the Easter weekend when it falls inside them.
    const rainsFrom = `${year}-04-01`;
    const rainsTo = `${year}-06-01`;
    if (goodFriday >= rainsFrom && easterTuesday <= rainsTo) {
      if (goodFriday > rainsFrom)
        ranges.push({ season: "low", from: rainsFrom, to: goodFriday, label: `Long rains ${year}` });
      ranges.push({ season: "low", from: easterTuesday, to: rainsTo, label: `Long rains ${year}` });
    } else if (goodFriday < rainsFrom && easterTuesday > rainsFrom) {
      ranges.push({ season: "low", from: easterTuesday, to: rainsTo, label: `Long rains ${year}` });
    } else {
      ranges.push({ season: "low", from: rainsFrom, to: rainsTo, label: `Long rains ${year}` });
    }

    ranges.push({ season: "high", from: goodFriday, to: easterTuesday, label: `Easter ${year}` });
    ranges.push({ season: "high", from: `${year}-07-01`, to: `${year}-09-01`, label: `July and August ${year}` });
    ranges.push({ season: "low", from: `${year}-11-01`, to: `${year}-12-15`, label: `Short rains ${year}` });
    ranges.push({ season: "high", from: `${year}-12-15`, to: `${year + 1}-01-06`, label: `Christmas ${year}` });
  }
  return ranges;
}

/** Stays that touch these dates must be at least this long. */
export function stayRules(fromYear: number, toYear: number) {
  const rules: { from: string; to: string; minNights: number; label: string }[] = [];
  for (let year = fromYear; year <= toYear; year++) {
    const easter = easterSunday(year);
    rules.push({ from: shift(easter, -2), to: shift(easter, 1), minNights: 2, label: "Easter weekend" });
    rules.push({ from: `${year}-12-24`, to: `${year + 1}-01-02`, minNights: 3, label: "Christmas and New Year" });
  }
  return rules;
}

/** Per night: [weeknight, weekend], in shillings. */
export const rates: Record<(typeof roomTypes)[number]["slug"], Record<SeasonCode, [number, number]>> = {
  "forest-cottage": { low: [14_500, 16_500], mid: [17_000, 19_500], high: [21_000, 24_000] },
  "mountain-tent": { low: [16_000, 18_500], mid: [19_000, 22_000], high: [23_500, 27_000] },
  "family-cottage": { low: [24_000, 27_500], mid: [28_500, 32_500], high: [34_500, 39_500] },
  "ukingo-house": { low: [58_000, 66_000], mid: [68_000, 78_000], high: [84_000, 96_000] },
};

export const mealPlans = [
  {
    code: "bed_and_breakfast",
    name: "Bed and breakfast",
    description: "Breakfast is included in every room price.",
    adultCents: 0,
    childCents: 0,
  },
  {
    code: "half_board",
    name: "Half board",
    description: "Breakfast and a three-course dinner.",
    adultCents: shillings(3_500),
    childCents: shillings(1_750),
  },
  {
    code: "full_board",
    name: "Full board",
    description: "Breakfast, lunch, afternoon tea and dinner.",
    adultCents: shillings(6_000),
    childCents: shillings(3_000),
  },
] as const;

export const extras = [
  {
    slug: "forest-walk",
    name: "Guided forest walk",
    description:
      "Two hours on foot with one of our guides, who grew up on this edge of the forest. Colobus, turacos, elephant tracks and, with luck, a bushbuck in the glades.",
    duration: "2 hours",
    priceCents: shillings(2_500),
    charged: "per_person",
  },
  {
    slug: "horse-ride",
    name: "Horse ride on the plains",
    description:
      "A quiet ride out across the open country below the lodge, among zebra and gazelle. Horses for beginners and for riders. Hats provided.",
    duration: "90 minutes",
    priceCents: shillings(5_500),
    charged: "per_person",
  },
  {
    slug: "game-drive",
    name: "Conservancy game drive",
    description:
      "A morning in an open vehicle in one of the Laikipia conservancies, forty minutes from the lodge, with a picnic breakfast. Conservancy entry fees are paid at the gate and are not included.",
    duration: "Half a day",
    priceCents: shillings(9_500),
    charged: "per_person",
  },
  {
    slug: "cedar-dinner",
    name: "Dinner under the cedars",
    description:
      "A table for your party set in the forest, by lantern light, with a fire beside it. Four courses, cooked over coals.",
    duration: "An evening",
    priceCents: shillings(4_800),
    charged: "per_person",
  },
  {
    slug: "nanyuki-transfer",
    name: "Transfer from Nanyuki",
    description:
      "We meet you in Nanyuki town or at the airstrip and bring you to the lodge. Up to six guests a vehicle.",
    duration: "30 minutes",
    priceCents: shillings(3_500),
    charged: "per_booking",
  },
] as const;

export const siteText = [
  { key: "home.headline", label: "Home page headline", value: "Where the forest ends and the mountain begins." },
  {
    key: "home.introduction",
    label: "Home page introduction",
    value:
      "Ukingo is a small lodge on the edge of the Mount Kenya forest, twenty minutes above Nanyuki. Twelve rooms, wood fires, and the peaks at breakfast.",
  },
  { key: "home.rooms.heading", label: "Home page: rooms heading", value: "Four ways to stay" },
  {
    key: "home.rooms.introduction",
    label: "Home page: rooms introduction",
    value:
      "Every price is for the room, not per person, and includes breakfast for everyone in it. Fires are laid every afternoon.",
  },
  { key: "home.place.heading", label: "Home page: place heading", value: "On the edge" },
  {
    key: "home.place.body",
    label: "Home page: place text",
    value:
      "Ukingo means edge. Behind the lodge the cedar forest climbs towards the moorland and the peaks. In front, the land falls away to the Laikipia plains. You wake to colobus in the trees and go to bed with a fire in the grate, 2,180 metres up and almost exactly on the equator.",
  },
  { key: "home.experiences.heading", label: "Home page: experiences heading", value: "While you are here" },
  {
    key: "home.experiences.introduction",
    label: "Home page: experiences introduction",
    value: "Walk, ride, or do nothing at all. Anything here can be added when you book.",
  },
  {
    key: "home.directions.heading",
    label: "Home page: directions heading",
    value: "Three and a half hours from Nairobi",
  },
  {
    key: "home.directions.body",
    label: "Home page: directions text",
    value:
      "Tarmac all the way to Nanyuki, then 14 km towards the mountain. The last stretch is a good murram road that any car manages in dry weather.",
  },
] as const;

export const pages = [
  {
    slug: "about",
    title: "About Ukingo",
    summary: "A small lodge on the edge of the Mount Kenya forest, run by the people who live here.",
    body: `Ukingo began as a farmhouse and a few fields at the top of a murram road, where the cultivated land stops and the Mount Kenya forest begins. The name is the Swahili word for an edge, and it is the simplest description of where we are.

## The place

The lodge stands at 2,180 metres. Behind it, cedar and olive forest climbs to the bamboo, the moorland and the peaks. In front, the land falls away north and west to the Laikipia plains. The equator runs a few kilometres to the south.

Mornings are bright and cold. Colobus monkeys cross the cedars beside the cottages, and elephants use the forest paths at night. By ten the sun is warm enough for breakfast outside. Evenings need a jersey and a fire, which is why every room has one.

## The lodge

There are twelve rooms: five stone cottages along the tree line, four tents on decks at the top of the meadow, two family cottages, and the old farmhouse, which is booked whole. The main house has the dining room, a sitting room with a long fire, and a veranda that faces the mountain.

The kitchen cooks from the garden and from farms nearby. Bread is baked each morning. Most of our team come from the villages below the forest, and several of the guides learned these paths as children.

## How we run it

Water is heated by the sun and by the kitchen's wood stoves. Fires burn off-cuts and fallen cedar from managed plots, never the forest. We keep the lodge small on purpose, so that the edge stays quiet.`,
  },
  {
    slug: "getting-here",
    title: "Getting here",
    summary: "By road from Nairobi in three and a half hours, or a short flight to Nanyuki.",
    body: `Ukingo is 14 km from Nanyuki town, on the Mount Kenya side.

## By road

From Nairobi, take the Thika road and carry on through Karatina and Naro Moru to Nanyuki. It is tarmac all the way and takes about three hours.

In Nanyuki, turn towards the mountain. The first 10 km are tarmac. The last 4 km are a murram road, graded each season, that any car manages in dry weather. After heavy rain a car with good clearance is more comfortable. We send directions and a map pin with your confirmation.

There is secure parking at the lodge.

## By air

Scheduled flights leave Wilson Airport in Nairobi for Nanyuki airstrip every day and take about 45 minutes. We can meet you at the airstrip or in town. Add a transfer when you book.

## Arriving

Check-in is from 2 pm and check-out is by 10.30 am. If you arrive earlier, leave your bags with us and have lunch, or walk in the forest until your room is ready.

Please plan to arrive before dark. The gate closes at 9 pm.`,
  },
  {
    slug: "booking-terms",
    title: "Booking and cancellation",
    summary: "How deposits, balances, changes and cancellations work.",
    body: `These are the terms for bookings made on this site. The dates and amounts that apply to your stay are shown before you pay and on your booking page afterwards. A booking keeps the terms it was made under, even if these change later.

## Prices

Prices are in Kenya shillings, per room per night, and include breakfast for everyone in the room and all taxes. They are for residents of Kenya.

## Holding a room

When you continue to payment, the room is held for you for 15 minutes. If payment is not made in that time the room goes back on sale.

## Deposit and balance

A deposit of 30% confirms your booking. The balance is due 14 days before you arrive. You can pay it from your booking page at any time before then, in one payment or several.

A booking made less than 14 days before arrival is paid in full when it is made.

## Changing your dates

You can move your stay to other dates, up to 7 days before you arrive, from your booking page. The new dates are charged at their own prices. If they cost more, the difference is added to your balance. If they cost less and you have already paid more than the new total, we refund the difference.

## Cancelling

- **30 days or more before arrival:** we refund everything you have paid.
- **14 to 29 days before arrival:** we keep the 30% deposit and refund the rest.
- **Less than 14 days before arrival, or if you do not arrive:** there is no refund.

You can cancel from your booking page, which shows the exact refund before you confirm. Refunds are sent to the M-Pesa number that paid, within 3 working days.

## Children

Children under 3 stay free. Children aged 3 to 11 pay half the price of half board and full board.`,
  },
  {
    slug: "privacy",
    title: "Privacy",
    summary: "What we collect when you book, and what we do with it.",
    body: `This notice explains what Ukingo collects through this site and why, in line with the Kenya Data Protection Act, 2019.

## What we collect

When you book, we ask for your name, your phone number and your email address, the dates and size of your party, and anything you choose to tell us about your stay. When you pay, Safaricom tells us the M-Pesa receipt number, the amount and the phone number that paid. We never see your M-Pesa PIN.

The site also records the internet address a booking was made from, to prevent abuse.

## What we use it for

- To make and manage your booking, and to look after you when you stay.
- To send you messages about that booking: the confirmation, receipts, reminders and directions.
- To keep the records of payment that the law requires.

We do not send marketing messages, and we do not sell or share your details with anyone for their own use.

## Who else sees it

Safaricom processes M-Pesa payments. Our email is delivered by an email service. Both receive only what they need to do that.

## How long we keep it

Booking and payment records are kept for seven years, as tax law requires. After that they are deleted.

## Your rights

You may ask to see the details we hold about you, to have them corrected, or to have them deleted where the law does not require us to keep them. Ask at the front desk during your stay, or write to The Manager, Ukingo, Private Bag, Nanyuki.

## Cookies

The site sets no advertising or tracking cookies. Staff who sign in to the back office receive one cookie that keeps them signed in.`,
  },
  {
    slug: "terms",
    title: "Terms of use",
    summary: "The terms on which this site is offered.",
    body: `By using this site you agree to these terms.

## Bookings

A booking is confirmed when we have received your deposit and you have seen a confirmation page with a booking reference. The terms on [booking and cancellation](/booking-terms) form part of every booking.

## Accuracy

We work to keep prices and availability on this site correct. If a price is shown in obvious error, we will tell you and give you the choice of paying the right price or cancelling with a full refund.

## Your stay

Guests are asked to follow the guidance of our team around the forest and its wildlife. Walks beyond the lodge grounds are with a guide. Children are welcome and remain the responsibility of their parents or guardians.

## Liability

Ukingo is not liable for loss caused by events outside its control, such as road closures or severe weather. Nothing in these terms limits any right you have under the laws of Kenya.

## Law

These terms are governed by the laws of Kenya.`,
  },
] as const;

export const questions = [
  {
    topic: "Booking",
    question: "Do I need to pay everything when I book?",
    answer:
      "No. A 30% deposit confirms your booking and the balance is due 14 days before you arrive. If you book less than 14 days ahead, the full amount is paid at booking.",
  },
  {
    topic: "Booking",
    question: "How do I pay?",
    answer:
      "By M-Pesa. Enter your Safaricom number, and a prompt appears on your phone asking for your PIN. You can pay the balance later from your booking page, in one payment or several.",
  },
  {
    topic: "Booking",
    question: "Can I change my dates?",
    answer:
      "Yes, up to 7 days before you arrive, from your booking page. The new dates are charged at their own prices, and the page shows the difference before you confirm.",
  },
  {
    topic: "Booking",
    question: "What happens if I cancel?",
    answer:
      "Thirty days or more before arrival, we refund everything. From 14 to 29 days, we keep the deposit and refund the rest. Inside 14 days there is no refund. Your booking page shows the exact amount before you confirm.",
  },
  {
    topic: "Booking",
    question: "I have lost my confirmation email. How do I find my booking?",
    answer:
      "Use Find my booking at the foot of any page. Enter your booking reference and the email address you booked with, and we send the link to that address again.",
  },
  {
    topic: "Your stay",
    question: "What is included in the price?",
    answer:
      "The room for everyone in it, breakfast, afternoon tea, firewood, parking and all taxes. Lunch and dinner are included if you choose half board or full board. Drinks and the activities listed under Experiences are extra.",
  },
  {
    topic: "Your stay",
    question: "Are children welcome?",
    answer:
      "Very. The family cottages and Ukingo House are best for families. Children under 3 stay free, and children aged 3 to 11 pay half price for half board and full board.",
  },
  {
    topic: "Your stay",
    question: "How cold does it get?",
    answer:
      "Nights are cold all year, often close to freezing in July and August. Every room has a fire or a wood stove and hot-water bottles. Bring a warm jacket, and closed shoes for walking.",
  },
  {
    topic: "Your stay",
    question: "Is there phone signal and Wi-Fi?",
    answer:
      "There is Safaricom signal across the property, and Wi-Fi in the main house. The cottages and tents are deliberately left without it.",
  },
  {
    topic: "Your stay",
    question: "Can you cater for my diet?",
    answer:
      "Yes. Tell us when you book, in the box for special requests, and the kitchen will plan for it. Vegetarian meals are always on the menu.",
  },
  {
    topic: "Getting here",
    question: "Do I need a four-wheel drive?",
    answer:
      "No. The last 4 km are murram, but any car manages it in dry weather. After heavy rain a car with good clearance is more comfortable, and we can meet you in Nanyuki if you prefer.",
  },
  {
    topic: "Getting here",
    question: "What time can I arrive and leave?",
    answer: "Check-in is from 2 pm and check-out is by 10.30 am. Please arrive before dark. The gate closes at 9 pm.",
  },
] as const;
