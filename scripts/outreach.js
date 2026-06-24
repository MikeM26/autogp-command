import { createClient } from "@supabase/supabase-js";
import OpenAI from "openai";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const brevoKey = process.env.BREVO_API_KEY;
const senderEmail = process.env.SENDER_EMAIL || "mikem@autogp.co.za";
const senderName = process.env.SENDER_NAME || "Mike | AutoGP";

const AUTOGP_SERVICES = `
AutoGP is a full-service fleet management and maintenance partner operating across Gauteng, Mpumalanga and KwaZulu-Natal. Services include:
- Scheduled fleet maintenance and servicing
- Accident repairs and panel beating
- Spray painting and vehicle branding
- Windscreen repair and replacement
- Tyre fitment and balancing
- 24/7 nationwide towing and roadside recovery
- Real-time fleet tracking
- Bulk diesel supply
`;

function isValidEmail(email) {
  return typeof email === "string" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

async function main() {
  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, company_name, industry, region, email, decision_maker, outreach_count")
    .eq("stage", "Enriched")
    .not("email", "is", null)
    .limit(3);

  if (error) throw error;

  if (!leads || leads.length === 0) {
    console.log("No enriched leads with email ready for outreach.");
    return;
  }

  let sent = 0;
  let skipped = 0;

  for (const lead of leads) {
    const recipientEmail = lead.email?.trim().toLowerCase();
    const recipientName = lead.decision_maker || lead.company_name;

    if (!isValidEmail(recipientEmail)) {
      skipped++;
      console.log(`Skipped invalid email: ${lead.company_name}`);
      continue;
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.75,
      max_tokens: 260,
      messages: [
        {
          role: "system",
          content: "You write short, warm, human B2B emails from one real person to another. Never robotic. Never template-sounding. Respect the reader's time. No exclamation marks. No buzzwords."
        },
        {
          role: "user",
          content: `Write a brief cold email from Mike at AutoGP to ${recipientName} at ${lead.company_name}, a ${lead.industry || "company with a vehicle fleet"} based in ${lead.region || "South Africa"}.

AutoGP services (pick only 2-3 that fit this company - do not list all):
${AUTOGP_SERVICES}

Rules:
- Open with something specific to ${lead.company_name} or their industry - show you thought about them
- Lead with the real pain: vehicle downtime costs them money
- Mention only 2-3 relevant services, woven naturally into sentences - never a bullet list
- Under 90 words total
- No subject line in the body
- No Calendly link, no book a call, no 30-minute meeting
- End with exactly this line: Looking forward to hearing from you.
- Sign off as: Mike`
        }
      ]
    });

    let emailBody = completion.choices?.[0]?.message?.content?.trim();
    if (!emailBody) {
      skipped++;
      continue;
    }

    emailBody = emailBody.replace(/\s*Mike\s*$/, "").trim();
    emailBody += `\n\nLooking forward to hearing from you.\n\nMike\nAutoGP\nmikem@autogp.co.za\nwww.autogp.co.za`;

    const subject = `${lead.company_name} — fleet support`;

    const brevoRes = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": brevoKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        sender: { name: senderName, email: senderEmail },
        replyTo: { name: senderName, email: senderEmail },
        to: [{ email: recipientEmail, name: recipientName }],
        subject,
        textContent: emailBody
      })
    });

    if (!brevoRes.ok) {
      const err = await brevoRes.text();
      console.error(`Brevo error for ${lead.company_name}: ${err}`);
      skipped++;
      continue;
    }

    await supabase.from("leads").update({
      stage: "Active",
      last_activity: new Date().toISOString(),
      last_outreach_at: new Date().toISOString(),
      outreach_count: (lead.outreach_count || 0) + 1,
      last_email_subject: subject,
      last_email_body: emailBody,
      reply_status: "No reply"
    }).eq("id", lead.id);

    sent++;
    console.log(`Sent to ${recipientEmail} | ${lead.company_name}`);
  }

  console.log(JSON.stringify({ sent, skipped, total: leads.length }, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
