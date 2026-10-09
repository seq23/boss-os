/**
 * MONIQUE'S OUTREACH: THE ONE LIST OF BUSINESSES (owner, 9 Oct 2026: "u do it all").
 *
 * Every business, its sending address, its offer, who it writes to, where those addresses are read
 * from, and the three emails it sends. The database holds only STATE keyed by `key`
 * (`outreach_domain_state`, `outreach_prospects`), so this file and the tables can never disagree
 * about which businesses exist.
 *
 * Rules carried here, not remembered:
 *   · how-we-know is absent on purpose: no outreach until about 1,000 subscribers.
 *   · Spry and West Peek stay separate: no sender below is on westpeek.ventures, spry.vc or
 *     sequoiataylor.com, and `assertSenderAllowed` refuses one at send time.
 *   · Sources are PUBLIC listings and the businesses' own websites. Never her network, never
 *     client data (memory: client-data-never-feeds-west-peek).
 *   · Signed by the brand, never by a person (the Kindle front-door rule).
 */

export type BusinessKind = "local_guide" | "affiliate" | "direct";

export interface Metro {
  key: string;
  label: string;
  /** south, west, north, east */
  bbox: [number, number, number, number];
}

export const METROS: Metro[] = [
  { key: "nyc", label: "New York City", bbox: [40.49, -74.26, 40.92, -73.7] },
  { key: "la", label: "Los Angeles", bbox: [33.7, -118.67, 34.34, -118.15] },
  { key: "chicago", label: "Chicago", bbox: [41.64, -87.94, 42.02, -87.52] },
  { key: "dallas", label: "Dallas", bbox: [32.62, -97.0, 33.02, -96.55] },
  { key: "houston", label: "Houston", bbox: [29.52, -95.79, 30.11, -95.01] },
];

export interface Segment {
  key: string;
  label: string;
  /** OpenStreetMap tag filters, each one `["k"~"v"]` clause set; unioned. Public data (ODbL). */
  osm: string[];
  /** The business's own website must say this, or it is not who we are writing to. */
  qualify: RegExp;
}

export interface Step {
  /** Days after the previous step. Step 0 is 0. */
  afterDays: number;
  subject: string;
  body: string;
}

export interface Business {
  key: string;
  domain: string;
  brand: string;
  kind: BusinessKind;
  sender: string;
  offerUrl: string;
  /** One line, used on Monique's card. */
  offer: string;
  segments: Segment[];
  /** Placeholders: {org} {metro} {brand} {offer_url} {ref_link}. */
  steps: [Step, Step, Step];
  /** What the owner's card suggests when someone says yes. */
  nextStep: string;
}

const LOCAL_FOLLOW_UPS = (what: string, price: string): [Step, Step] => [
  {
    afterDays: 4,
    subject: "Re: {subject}",
    body:
      "Hi {org} team,\n\nA quick follow-up on the featured listing. The first 2 months are free, then " +
      price + ". You can see exactly how a featured " + what + " listing looks here: {offer_url}\n\n" +
      "Reply \"yes\" and we will set it up for you.",
  },
  {
    afterDays: 7,
    subject: "Re: {subject}",
    body:
      "Hi {org} team,\n\nLast note from us on this. If a featured listing is not a fit right now, no " +
      "problem, and you will not hear from us again about it. If it is, the details are here: {offer_url}",
  },
];

export const BUSINESSES: Business[] = [
  {
    key: "uscisexam",
    domain: "uscisexam.com",
    brand: "USCIS Exam Guides",
    kind: "local_guide",
    sender: "hello@uscisexam.com",
    offerUrl: "https://uscisexam.com/for-providers/",
    offer: "Featured civil-surgeon listing, 2 months free, then $249/month per metro",
    segments: [{
      key: "civil_surgeons",
      label: "USCIS civil surgeons",
      osm: ['["amenity"~"^(doctors|clinic)$"]'],
      qualify: /civil surgeon|i-693|immigration medical/i,
    }],
    steps: [
      {
        afterDays: 0,
        subject: "Featured civil-surgeon listing in {metro}",
        body:
          "Hi {org} team,\n\nUSCIS Exam Guides explains the Form I-693 medical exam to applicants in " +
          "{metro}, and they use it to choose a civil surgeon. We would like to feature your practice. " +
          "The first 2 months are free, then $249/month for the metro.\n\nHow it works: {offer_url}\n\n" +
          "Reply \"yes\" and we will set it up.",
      },
      ...LOCAL_FOLLOW_UPS("civil-surgeon", "$249/month for the metro"),
    ],
    nextStep: "Reply with the setup link from /for-providers/ and start their 2 free months.",
  },
  {
    key: "dentistryguides",
    domain: "dentistryguides.com",
    brand: "The Dentistry Guides",
    kind: "local_guide",
    sender: "hello@dentistryguides.com",
    offerUrl: "https://dentistryguides.com/for-providers/",
    offer: "Featured implant/cosmetic listing, 2 months free, then $249/month per metro",
    segments: [{
      key: "implant_cosmetic",
      label: "Implant and cosmetic dental practices",
      osm: ['["amenity"="dentist"]', '["healthcare"="dentist"]'],
      qualify: /implant|cosmetic|veneer/i,
    }],
    steps: [
      {
        afterDays: 0,
        subject: "Featured implant listing in {metro}",
        body:
          "Hi {org} team,\n\nThe Dentistry Guides helps patients in {metro} compare implant and cosmetic " +
          "dentists and what they cost. We would like to feature your practice. The first 2 months are " +
          "free, then $249/month for the metro.\n\nHow it works: {offer_url}\n\nReply \"yes\" and we will set it up.",
      },
      ...LOCAL_FOLLOW_UPS("dental", "$249/month for the metro"),
    ],
    nextStep: "Reply with the setup link from /for-providers/ and start their 2 free months.",
  },
  {
    key: "hormonesivhair",
    domain: "hormonesivhair.com",
    brand: "Hormone Optimization Guides",
    kind: "local_guide",
    sender: "hello@hormonesivhair.com",
    offerUrl: "https://hormonesivhair.com/for-providers/",
    offer: "Featured TRT/IV/hair listing, 2 months free, then $249/month per metro",
    segments: [{
      key: "trt_iv_hair",
      label: "TRT, IV and hair-restoration clinics",
      osm: ['["amenity"~"^(doctors|clinic)$"]', '["healthcare"~"^(clinic|doctor|alternative)$"]'],
      qualify: /testosterone|\bTRT\b|IV therapy|IV hydration|hair restoration|hair transplant|hormone/i,
    }],
    steps: [
      {
        afterDays: 0,
        subject: "Featured clinic listing in {metro}",
        body:
          "Hi {org} team,\n\nHormone Optimization Guides helps people in {metro} compare TRT, IV and " +
          "hair-restoration clinics. We would like to feature your clinic. The first 2 months are free, " +
          "then $249/month for the metro.\n\nHow it works: {offer_url}\n\nReply \"yes\" and we will set it up.",
      },
      ...LOCAL_FOLLOW_UPS("clinic", "$249/month for the metro"),
    ],
    nextStep: "Reply with the setup link from /for-providers/ and start their 2 free months.",
  },
  {
    key: "neuroevalguides",
    domain: "neuroevalguides.com",
    brand: "Neuro Evaluation Guides",
    kind: "local_guide",
    sender: "hello@neuroevalguides.com",
    offerUrl: "https://neuroevalguides.com/for-providers/",
    offer: "Featured evaluator listing, 2 months free, then $249/month per metro",
    segments: [{
      key: "evaluators",
      label: "Neuropsychologists and ADHD/autism evaluators",
      osm: ['["healthcare"~"^(psychotherapist|psychologist|doctor|clinic)$"]', '["amenity"~"^(doctors|clinic)$"]'],
      qualify: /neuropsych|ADHD (evaluation|testing|assessment)|autism (evaluation|testing|assessment)|psychological testing/i,
    }],
    steps: [
      {
        afterDays: 0,
        subject: "Featured evaluator listing in {metro}",
        body:
          "Hi {org} team,\n\nNeuro Evaluation Guides helps families in {metro} find ADHD, autism and " +
          "neuropsychological evaluations. We would like to feature your practice. The first 2 months are " +
          "free, then $249/month for the metro.\n\nHow it works: {offer_url}\n\nReply \"yes\" and we will set it up.",
      },
      ...LOCAL_FOLLOW_UPS("evaluator", "$249/month for the metro"),
    ],
    nextStep: "Reply with the setup link from /for-providers/ and start their 2 free months.",
  },
  {
    key: "theaccidentguides",
    domain: "theaccidentguides.com",
    brand: "The Accident Guides",
    kind: "local_guide",
    sender: "hello@theaccidentguides.com",
    offerUrl: "https://theaccidentguides.com/for-providers/",
    offer: "Featured injury-firm listing, 2 months free, then $499/month per state",
    segments: [{
      key: "pi_firms",
      label: "Personal-injury law firms",
      osm: ['["office"="lawyer"]'],
      qualify: /personal injury|car accident|truck accident|injury (attorney|lawyer)/i,
    }],
    steps: [
      {
        afterDays: 0,
        subject: "Featured injury-firm listing for {metro}",
        body:
          "Hi {org} team,\n\nThe Accident Guides explains personal-injury claims to people in {metro} " +
          "right after an accident, and points them to a firm. We would like to feature yours. The first " +
          "2 months are free, then $499/month for the state.\n\nHow it works: {offer_url}\n\n" +
          "Reply \"yes\" and we will set it up.",
      },
      ...LOCAL_FOLLOW_UPS("injury-firm", "$499/month for the state"),
    ],
    nextStep: "Reply with the setup link from /for-providers/ and start their 2 free months (state-wide, $499 after).",
  },
  {
    key: "time2read",
    domain: "time-2-read.com",
    brand: "Time2Read",
    kind: "affiliate",
    sender: "st@time-2-read.com",
    offerUrl: "https://time-2-read.com/",
    offer: "Affiliate: 30% of each referred family's first-year revenue",
    segments: [{
      key: "reading_tutors",
      label: "Reading tutors and learning centres",
      osm: ['["amenity"="prep_school"]', '["office"="educational_institution"]', '["amenity"="school"]["name"~"[Tt]utor|[Ll]earning|[Rr]eading"]'],
      qualify: /reading|tutor|literacy|homeschool/i,
    }],
    steps: [
      {
        afterDays: 0,
        subject: "A reading partnership for {org}",
        body:
          "Hi {org} team,\n\nTime2Read is interactive reading adventures for kids, built to get them " +
          "reading between sessions. We pay partners 30% of the first year's revenue from every family " +
          "they refer, through a personal referral code.\n\nHave a look: {offer_url}\n\n" +
          "Reply \"yes\" and we will send your code.",
      },
      {
        afterDays: 4,
        subject: "Re: {subject}",
        body:
          "Hi {org} team,\n\nFollowing up on the referral partnership: 30% of first-year revenue for each " +
          "family you send, tracked by your own code. Reply \"yes\" and it is yours.",
      },
      {
        afterDays: 7,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nLast note from us. If it is ever useful, the offer stands: {offer_url}",
      },
    ],
    nextStep: "Reply with their referral code and link (30% of first-year revenue).",
  },
  {
    key: "heygetonmylevel",
    domain: "heygetonmylevel.com",
    brand: "HeyGetOnMyLevel",
    kind: "direct",
    sender: "hello@heygetonmylevel.com",
    offerUrl: "https://heygetonmylevel.com/",
    offer: "Direct: $49/month per site for adult-ed, ESL programmes and libraries",
    segments: [
      {
        key: "libraries",
        label: "Public libraries",
        osm: ['["amenity"="library"]'],
        qualify: /library/i,
      },
      {
        key: "adult_ed",
        label: "Adult-ed and ESL programmes",
        osm: ['["amenity"~"^(school|college|language_school)$"]'],
        qualify: /adult education|\bESL\b|English as a second language|\bGED\b|adult literacy/i,
      },
    ],
    steps: [
      {
        afterDays: 0,
        subject: "Reading practice for your adult learners",
        body:
          "Hi {org} team,\n\nHeyGetOnMyLevel is AI-powered reading practice that meets adult and ESL " +
          "learners at their level. A site licence is $49/month.\n\nSee it: {offer_url}\n\n" +
          "Reply \"yes\" and we will set up a free look for your staff.",
      },
      {
        afterDays: 4,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nA quick follow-up: $49/month per site, no long contract. Reply \"yes\" for a free look.",
      },
      {
        afterDays: 7,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nLast note from us. If it helps later, it is here: {offer_url}",
      },
    ],
    nextStep: "Reply with a trial link and the $49/month site price.",
  },
  {
    key: "aplayermode",
    domain: "aplayermode.com",
    brand: "A Player Mode",
    kind: "affiliate",
    sender: "hello@aplayermode.com",
    offerUrl: "https://aplayermode.com/",
    offer: "Affiliate: 30% of each referred customer's first-year revenue",
    segments: [{
      key: "coaches",
      label: "Productivity and executive coaches",
      osm: ['["office"~"^(consulting|coaching|company)$"]["name"~"[Cc]oach"]'],
      qualify: /coach|coaching/i,
    }],
    steps: [
      {
        afterDays: 0,
        subject: "A partnership for {org}'s clients",
        body:
          "Hi {org} team,\n\nA Player Mode gives one person a five-person executive team. Coaches who " +
          "recommend it earn 30% of the first year's revenue from every client they refer, through a " +
          "personal code.\n\nHave a look: {offer_url}\n\nReply \"yes\" and we will send your code.",
      },
      {
        afterDays: 4,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nFollowing up: 30% of first-year revenue per referred client. Reply \"yes\" for your code.",
      },
      {
        afterDays: 7,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nLast note from us. The offer stands if it is ever useful: {offer_url}",
      },
    ],
    nextStep: "Reply with their referral code and link (30% of first-year revenue).",
  },
  {
    key: "approvalprep",
    domain: "approvalprep.com",
    brand: "ApprovalPrep",
    kind: "affiliate",
    sender: "hello@approvalprep.com",
    offerUrl: "https://approvalprep.com/",
    offer: "Affiliate: 30% of each referred customer's first-year revenue",
    segments: [
      {
        key: "rental_agents",
        label: "Real-estate and rental agents",
        osm: ['["office"="estate_agent"]'],
        qualify: /rent|leasing|real estate|apartment/i,
      },
      {
        key: "credit_counsellors",
        label: "Credit and housing counsellors",
        osm: ['["office"~"^(financial|financial_advisor|ngo|consulting)$"]["name"~"[Cc]redit|[Hh]ousing"]'],
        qualify: /credit counsel|housing counsel|credit repair|financial counsel/i,
      },
    ],
    steps: [
      {
        afterDays: 0,
        subject: "Helping your applicants get approved",
        body:
          "Hi {org} team,\n\nApprovalPrep sells self-service letter kits for rental, credit and loan " +
          "applications, from $15. Partners earn 30% of the first year's revenue from everyone they " +
          "refer, through a personal code.\n\nHave a look: {offer_url}\n\nReply \"yes\" and we will send your code.",
      },
      {
        afterDays: 4,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nFollowing up: 30% of first-year revenue per referral, tracked by your code. Reply \"yes\" for yours.",
      },
      {
        afterDays: 7,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nLast note from us. The offer stands if it is ever useful: {offer_url}",
      },
    ],
    nextStep: "Reply with their referral code and link (30% of first-year revenue).",
  },
  {
    key: "weddingchecklist",
    domain: "weddingchecklistpdf.com",
    brand: "Wedding Checklist PDF",
    kind: "affiliate",
    sender: "hello@weddingchecklistpdf.com",
    offerUrl: "https://weddingchecklistpdf.com/",
    offer: "Affiliate: 30% of each referred couple's first-year revenue",
    segments: [{
      key: "wedding_planners",
      label: "Wedding planners",
      osm: ['["office"~"^(event_management|company)$"]["name"~"[Ww]edding|[Ee]vent"]', '["craft"="event_planner"]', '["shop"="wedding"]'],
      qualify: /wedding/i,
    }],
    steps: [
      {
        afterDays: 0,
        subject: "A planning tool for {org}'s couples",
        body:
          "Hi {org} team,\n\nWedding Checklist PDF makes printable, editable planning checklists, from $9. " +
          "Planners who share it earn 30% of the first year's revenue from every couple they refer, " +
          "through a personal code.\n\nHave a look: {offer_url}\n\nReply \"yes\" and we will send your code.",
      },
      {
        afterDays: 4,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nFollowing up: 30% of first-year revenue per couple you refer. Reply \"yes\" for your code.",
      },
      {
        afterDays: 7,
        subject: "Re: {subject}",
        body: "Hi {org} team,\n\nLast note from us. The offer stands if it is ever useful: {offer_url}",
      },
    ],
    nextStep: "Reply with their referral code and link (30% of first-year revenue).",
  },
];

/** Addresses only the route proofs and the first test sends may reach while a domain is unproven. */
export const TEST_RECIPIENTS = ["cryptoclearr@gmail.com"] as const;

/** The one mailbox the outreach module impersonates. Every sending address is an alias of it. */
export const OUTREACH_MAILBOX = "st@time-2-read.com";

/** Never a sender, never a mailbox: the owner's other businesses and her own domain. */
export const FORBIDDEN_SENDER_DOMAINS = ["westpeek.ventures", "spry.vc", "sequoiataylor.com", "joinwestpeek.com"];

export function businessByKey(key: string): Business | undefined {
  return BUSINESSES.find((b) => b.key === key);
}

/** The sender must be on its own business domain and never on a forbidden one. Throws by name. */
export function assertSenderAllowed(b: Business): void {
  const domain = b.sender.split("@")[1]?.toLowerCase() ?? "";
  if (FORBIDDEN_SENDER_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    throw new Error(`Refused: ${b.sender} is on ${domain}, which outreach may never send from.`);
  }
  if (domain !== b.domain) {
    throw new Error(`Refused: ${b.sender} is not on ${b.brand}'s own domain (${b.domain}).`);
  }
}
