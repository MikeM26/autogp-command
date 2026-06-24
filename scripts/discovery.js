import { createClient } from "@supabase/supabase-js";
import ws from "ws";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY,
  { realtime: { transport: ws } }
);

const googleKey = process.env.GOOGLE_PLACES_API_KEY;
const hunterKey = process.env.HUNTER_API_KEY;

const queries = [
  "logistics company Johannesburg",
  "transport company Gauteng",
  "courier company Pretoria",
  "security company Johannesburg",
  "construction company Gauteng",
  "logistics company Durban",
  "transport company Durban KwaZulu-Natal",
  "construction company Nelspruit",
  "logistics company Mpumalanga",
  "fleet company Johannesburg",
  "delivery company Pretoria",
  "haulage company Gauteng"
];

async function googleMapsSearch(query) {
  const url = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(query)}&key=${googleKey}`;
  const res = await fetch(url);
  const data = await res.json();
  console.log(`Maps API status: ${data.status}`);
  if (data.error_message) console.error(`Maps error: ${data.error_message}`);
  return data.results || [];
}

async function getPlaceDetails(placeId) {
  const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=website,formatted_phone_number&key=${googleKey}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.result || {};
}

async function hunterEnrich(domain) {
  const url = `https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&api_key=${hunterKey}&limit=5`;
  const res = await fetch(url);
  const data = await res.json();
  const emails = data.data?.emails || [];
  console.log(`Hunter found ${emails.length} emails for ${domain}`);

  const priority = ["owner", "ceo", "director", "manager", "operations", "fleet", "executive", "logistics"];
  let best = emails.find(e =>
    priority.some(p => (e.position || "").toLowerCase().includes(p))
  );
  if (!best && emails.length > 0) best = emails[0];

  return best ? {
    email: best.value,
    firstName: best.first_name || "",
    lastName: best.last_name || "",
    position: best.position || ""
  } : null;
}

async function main() {
  const query = queries[Math.floor(Math.random() * queries.length)];
  console.log(`Running discovery for: ${query}`);

  let places = [];
  try {
    places = (await googleMapsSearch(query)).slice(0, 5);
    console.log(`Google Maps returned ${places.length} places`);
  } catch (err) {
    console.error(`Google Maps error: ${err.message}`);
    return;
  }

  if (places.length === 0) {
    console.log("No places returned from Google Maps");
    return;
  }

  let added = 0;
  let enriched = 0;

  for (const place of places) {
    try {
      console.log(`Processing: ${place.name}`);
      const details = await getPlaceDetails(place.place_id);
      const website = details.website || null;
      const phone = details.formatted_phone_number || null;
      console.log(`Website: ${website || "none"}`);

      const addr = place.formatted_address || "";
      const region =
        addr.includes("Durban") || addr.includes("KwaZulu") ? "Durban" :
        addr.includes("Nelspruit") || addr.includes("Mpumalanga") ? "Mpumalanga" :
        "Gauteng";

      let email = null;
      let decisionMaker = null;
      let stage = "Identified";

      if (website) {
        const domain = website
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
          .split("/")[0];

        const contact = await hunterEnrich(domain);
        if (contact?.email) {
          email = contact.email;
          decisionMaker = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || null;
          stage = "Enriched";
          enriched++;
          console.log(`Enriched: ${email} (${contact.position})`);
        }
      }

      const { error } = await supabase.from("leads").insert({
        company_name: place.name,
        industry: "Transport",
        region,
        website,
        phone,
        email,
        decision_maker: decisionMaker,
        source: "Google Maps + Hunter",
        score: email ? 72 : 50,
        stage,
        last_activity: new Date().toISOString()
      });

      if (error) {
        console.error(`Insert error for ${place.name}: ${error.message}`);
      } else {
        added++;
        console.log(`Saved: ${place.name} | ${stage}`);
      }
    } catch (err) {
      console.error(`Error processing ${place.name}: ${err.message}`);
    }
  }

  console.log(JSON.stringify({ query, added, enriched }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
