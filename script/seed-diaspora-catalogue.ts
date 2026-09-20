/**
 * Seeds Diaspora Funeral Services' product/add-on/bundle catalogue structure from the spec
 * relayed by their marketing-site session — names, descriptions, categories, tier structure.
 * Deliberately does NOT set any real money: every premium/cover/rate field is left null/0,
 * exactly matching "I'll set covers and pricing later." One-time, tenant-specific data load —
 * not reusable infrastructure, unlike everything else built this session.
 *
 * Known limitation, called out rather than silently worked around: computeIndividualAgeRatedPremium
 * (server/route-helpers.ts) and the register-policy add-on validation currently only accept
 * pricingMode "cover_topup" for individual_age_rated products — a "flat" add-on (what most of
 * this catalogue actually is) has no premium effect yet and would be REJECTED if attached via
 * the public registration API today. Seeded anyway so the catalogue exists to configure once
 * that's decided; do not wire client-facing add-on selection until this is resolved.
 *
 * Usage: npx tsx script/seed-diaspora-catalogue.ts
 */
import "dotenv/config";
import { Pool } from "pg";
import { randomUUID } from "crypto";

const ORG_ID = "094f540b-7905-4770-b696-383b2e62042f";

function stripSsl(u: string) {
  return u.replace(/[?&]sslmode=[^&]*/gi, "").replace(/\?$/, "");
}

const PRODUCTS = [
  {
    code: "ESSENTIAL",
    name: "Essential",
    description:
      "Simple. Dignified. Dependable. Affordable, fundamental funeral protection for families who want the essentials handled properly. For families who want dependable cover without complexity. Includes: core funeral cover, dignified coffin and hearse, burial arrangement coordination, digital communication and SMS updates. Concierge: digital service with standard customer support.",
  },
  {
    code: "CLASSIC",
    name: "Classic",
    description:
      "More care. More choice. More comfort. A more comprehensive funeral experience with room to personalise the details that matter. For families who want more comfort and more say in the arrangements. Includes everything in Essential, plus enhanced casket and ceremony options, ceremony and venue support, and selected personalisation add-ons. Concierge: priority customer support.",
  },
  {
    code: "PRESTIGE",
    name: "Prestige",
    description:
      "Elevated care for an exceptional farewell. Premium services and an enhanced funeral experience, coordinated with close attention to detail. For families who want an elevated, well-appointed farewell. Includes everything in Classic, plus premium casket and floral arrangements, photography/videography/livestreaming, and memorial collateral. Concierge: dedicated Funeral Care support.",
  },
  {
    code: "BESPOKE",
    name: "Bespoke",
    description:
      "Your funeral. Your vision. Our fulfilment. For families with highly personalised requirements — designed around your wishes, coordinated end to end. Includes everything in Prestige, plus fully personalised funeral design, custom caskets/decor/memorial pieces, and highly personalised coordination. Concierge: highly personalised, end-to-end funeral coordination.",
  },
] as const;

interface AddOnSeed {
  slug: string;
  name: string;
  category: string;
  description: string;
}

const CATEGORY = {
  A: "Funeral Essentials",
  B: "Personalisation & Memorial",
  C: "Ceremony & Venue",
  D: "Hospitality",
  E: "Media & Memories",
  F: "Family Support",
  G: "Travel",
} as const;

// will-writing ("included" everywhere, nothing to ever sell) is deliberately omitted.
const ADD_ONS: AddOnSeed[] = [
  { slug: "premium-casket", name: "Premium Casket", category: CATEGORY.A, description: "A carefully finished casket for families who want the centrepiece of the farewell to reflect the care they feel. Available in a range of woods and finishes. Includes: choice of finish and fittings, interior lining options, delivery and preparation." },
  { slug: "custom-casket", name: "Custom-Made Casket", category: CATEGORY.B, description: "For families who want something made specifically for their loved one — dimensions, materials, detailing and personalisation designed with our team. Includes: design consultation, choice of materials/detailing, personalisation and engraving. Custom quote — no fixed price." },
  { slug: "custom-grave-marker", name: "Custom Grave Marker", category: CATEGORY.B, description: "A lasting memorial that reflects the life and personality of your loved one. Includes: choice of materials, design options, personalisation/optional engraving, photo examples on request. Custom quote — no fixed price." },
  { slug: "custom-coffin-lace", name: "Personalised Coffin Lace", category: CATEGORY.B, description: "Personalised coffin lace and drapery. Includes: personalised design, choice of fabric/finish. Example phrasing available (Shona/Ndebele/English) or fully custom." },
  { slug: "customised-blanket", name: "Customised Blanket", category: CATEGORY.B, description: "A personalised blanket as a keepsake or for the service. Includes: personalised print/embroidery, choice of material." },
  { slug: "memorial-banner", name: "Memorial Banner", category: CATEGORY.B, description: "A large-format banner honouring your loved one. Includes: design/layout, large-format print, stand/mounting." },
  { slug: "memorial-programme", name: "Funeral Programmes", category: CATEGORY.B, description: "Printed order-of-service programmes for mourners. Includes: design/typesetting, quality print, quantity to suit." },
  { slug: "memorial-collateral", name: "Memorial Collateral & Merchandise", category: CATEGORY.B, description: "T-shirts, printed keepsakes and memorial merchandise. Includes: design, choice of items, production/delivery." },
  { slug: "decor-and-tents", name: "Décor, Tents & Seating", category: CATEGORY.C, description: "Tents, chairs, draping and coordinated décor. Includes: tents/seating, draping/décor, setup and removal." },
  { slug: "pa-system", name: "PA System", category: CATEGORY.C, description: "Public address system with an operator. Includes: speakers/microphones, on-site operator." },
  { slug: "floodlights", name: "Floodlights & Power", category: CATEGORY.C, description: "Lighting and power for evening vigils and early services. Includes: floodlights, generator/power, setup. Location-dependent pricing." },
  { slug: "scented-candles", name: "Candles & Ceremonial Incense", category: CATEGORY.C, description: "Scented candles and ceremonial incense. Includes: candles, ceremonial incense on request, holders/setup. (Catholic ceremonial tag.)" },
  { slug: "floral-arrangement", name: "Floral Arrangements", category: CATEGORY.C, description: "Fresh floral arrangements for service and graveside. Includes: coffin arrangement, service/graveside flowers, design consultation." },
  { slug: "grave-flowers", name: "Graveside Flowers", category: CATEGORY.A, description: "Flowers prepared specifically for the committal and graveside. Includes: graveside floral pieces, placement." },
  { slug: "graveside-snacks", name: "Graveside Refreshments", category: CATEGORY.D, description: "Water, refreshments and snacks at the graveside. Includes: water/refreshments, light snacks, service staff. Priced per person." },
  { slug: "catering", name: "Catering", category: CATEGORY.D, description: "Full catering for family and mourners after the service. Includes: menu planning, staff/equipment, service and clear-up. Priced per person." },
  { slug: "family-hospitality", name: "Family Hospitality Package", category: CATEGORY.D, description: "Dedicated hospitality for the immediate family across the funeral period. Includes: meals across the period, refreshments, dedicated support. Custom quote — no fixed price." },
  { slug: "photography", name: "Professional Photography", category: CATEGORY.E, description: "A professional photographer documenting the service with discretion. Includes: coverage of service/committal, edited digital gallery, print options." },
  { slug: "videography", name: "Professional Videography", category: CATEGORY.E, description: "Filmed coverage edited into a keepsake film. Includes: multi-part coverage, edited keepsake film, digital delivery." },
  { slug: "livestreaming", name: "Funeral Livestreaming", category: CATEGORY.E, description: "A private, reliable live broadcast for family who cannot travel. Includes: on-site crew/connectivity, private stream link, recording provided afterwards." },
  { slug: "memorial-video", name: "Memorial Video", category: CATEGORY.E, description: "A produced tribute video from the family's photos and footage. Includes: photo/footage collection, editing and music, digital delivery." },
  { slug: "online-tribute", name: "Online Tribute & Announcement", category: CATEGORY.E, description: "A shareable online memorial page and funeral announcement. Includes: memorial page, funeral announcement, tribute wall." },
  { slug: "grief-counselling", name: "Online Grief Support", category: CATEGORY.F, description: "Confidential online grief support sessions for the family. Includes: online sessions, available to multiple family members, referral guidance. Priced per session." },
  { slug: "post-funeral-support", name: "Post-Funeral Support", category: CATEGORY.F, description: "Practical and emotional support after the funeral. Includes: follow-up check-ins, practical guidance, referral to further support. Included with selected packages; add-on otherwise." },
  { slug: "individual-travel-pack", name: "Individual Travelling Pack", category: CATEGORY.G, description: "A pack for one family member travelling home for the funeral. Includes: essentials, personal care items, funeral-related items, configurable contents." },
  { slug: "family-travel-pack", name: "Family Travelling Pack", category: CATEGORY.G, description: "A larger pack for a family group travelling home together. Includes: group essentials, family items, funeral-related items, configurable." },
  { slug: "travel-assistance", name: "Travel & Attendance Assistance", category: CATEGORY.G, description: "Coordination support for family travelling to and attending the funeral. Includes: logistics guidance, on-the-ground assistance, coordination with funeral team. Custom quote — no fixed price." },
];

const BUNDLES = [
  { name: "The Tribute Collection", description: "Everything that turns a service into a tribute — flowers, a banner, and a full visual record.", items: ["floral-arrangement", "memorial-banner", "photography", "videography", "memorial-collateral"] },
  { name: "The Graveside Collection", description: "For a graveside that feels considered and complete, right to the last moment.", items: ["grave-flowers", "custom-grave-marker", "graveside-snacks", "decor-and-tents"] },
  { name: "The Traveller's Collection", description: "For family coming home for the funeral — the practical things, handled.", items: ["family-travel-pack", "individual-travel-pack", "memorial-programme", "customised-blanket", "travel-assistance"] },
  { name: "The Farewell Collection", description: "An elevated farewell, coordinated as one — from the casket to the final photograph.", items: ["premium-casket", "custom-casket", "floral-arrangement", "scented-candles", "decor-and-tents", "photography", "videography"] },
  { name: "The Digital Memory Collection", description: "So no one is left out, and nothing is forgotten.", items: ["photography", "videography", "livestreaming", "memorial-video", "online-tribute"] },
  { name: "The Catholic Farewell Collection", description: "Ceremonial items for a Catholic service, for families whose tradition calls for them. Entirely optional.", items: ["scented-candles", "floral-arrangement", "decor-and-tents", "memorial-programme"] },
];

async function main() {
  const pool = new Pool({ connectionString: stripSsl(process.env.DATABASE_URL!), ssl: { rejectUnauthorized: false } });

  const org = await pool.query(`select id, name from organizations where id = $1`, [ORG_ID]);
  if (org.rows.length === 0) {
    console.error(`No organization found with id ${ORG_ID}`);
    await pool.end();
    process.exit(1);
  }

  console.log(`Seeding catalogue for ${org.rows[0].name}...\n`);

  // ── Products + one version each ──────────────────────────────────
  const productIdByCode: Record<string, string> = {};
  for (const p of PRODUCTS) {
    const existing = await pool.query(`select id from products where organization_id = $1 and code = $2`, [ORG_ID, p.code]);
    let productId: string;
    if (existing.rows.length > 0) {
      productId = existing.rows[0].id;
      await pool.query(
        `update products set name = $1, description = $2, pricing_model = 'individual_age_rated', is_active = true where id = $3`,
        [p.name, p.description, productId],
      );
      console.log(`Updated product: ${p.name} (${productId})`);
    } else {
      productId = randomUUID();
      await pool.query(
        `insert into products (id, organization_id, name, code, description, pricing_model, cover_currency, is_active)
         values ($1, $2, $3, $4, $5, 'individual_age_rated', 'USD', true)`,
        [productId, ORG_ID, p.name, p.code, p.description],
      );
      console.log(`Created product: ${p.name} (${productId})`);
    }
    productIdByCode[p.code] = productId;

    const existingVersion = await pool.query(`select id from product_versions where product_id = $1`, [productId]);
    if (existingVersion.rows.length === 0) {
      const versionId = randomUUID();
      await pool.query(
        `insert into product_versions (id, product_id, organization_id, version, effective_from, is_active)
         values ($1, $2, $3, 1, current_date, true)`,
        [versionId, productId, ORG_ID],
      );
      console.log(`  + version 1 (${versionId}) — no rate cards yet, price at $0 until configured`);
    }
  }

  // ── Add-ons ───────────────────────────────────────────────────────
  const addOnIdBySlug: Record<string, string> = {};
  for (const a of ADD_ONS) {
    const existing = await pool.query(`select id from add_ons where organization_id = $1 and name = $2`, [ORG_ID, a.name]);
    if (existing.rows.length > 0) {
      addOnIdBySlug[a.slug] = existing.rows[0].id;
      await pool.query(`update add_ons set description = $1, category = $2 where id = $3`, [a.description, a.category, existing.rows[0].id]);
      console.log(`Updated add-on: ${a.name}`);
    } else {
      const id = randomUUID();
      await pool.query(
        `insert into add_ons (id, organization_id, name, description, category, pricing_mode, is_active)
         values ($1, $2, $3, $4, $5, 'flat', true)`,
        [id, ORG_ID, a.name, a.description, a.category],
      );
      addOnIdBySlug[a.slug] = id;
      console.log(`Created add-on: ${a.name} [${a.category}]`);
    }
  }

  // ── Bundles ───────────────────────────────────────────────────────
  for (const b of BUNDLES) {
    const itemIds = b.items.map((slug) => addOnIdBySlug[slug]).filter(Boolean);
    const existing = await pool.query(`select id from benefit_bundles where organization_id = $1 and name = $2`, [ORG_ID, b.name]);
    if (existing.rows.length > 0) {
      await pool.query(`update benefit_bundles set description = $1, items = $2 where id = $3`, [b.description, JSON.stringify(itemIds), existing.rows[0].id]);
      console.log(`Updated bundle: ${b.name}`);
    } else {
      const id = randomUUID();
      await pool.query(
        `insert into benefit_bundles (id, organization_id, name, description, items, is_active)
         values ($1, $2, $3, $4, $5, true)`,
        [id, ORG_ID, b.name, b.description, JSON.stringify(itemIds)],
      );
      console.log(`Created bundle: ${b.name} (${itemIds.length} items)`);
    }
  }

  console.log(`\nDone. ${PRODUCTS.length} products, ${ADD_ONS.length} add-ons, ${BUNDLES.length} bundles.`);
  console.log("Nothing here has a real price yet — cover amounts, rate cards, and add-on prices are all still $0/null.");
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
