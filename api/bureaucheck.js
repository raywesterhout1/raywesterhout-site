// Vercel serverless function: ontvangt de uitslag van de Bureaucheck en zet de
// inzender in Kit (formulier + tags + velden). Zelfde aanpak als
// horeca-ai-score/src/lib/kit.ts, maar zonder framework.
//
// Omgevingsvariabelen (Vercel project raywesterhout-site):
//   KIT_API_KEY   verplicht
//   KIT_FORM_ID   optioneel, formulier waarop wordt ingeschreven

const KIT = "https://api.convertkit.com/v3";
const KLEUREN = new Set(["groen", "oranje", "rood"]);

async function kitPost(path, body) {
  const res = await fetch(`${KIT}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ api_key: process.env.KIT_API_KEY, ...body }),
  });
  return res.json().catch(() => ({}));
}

async function tagSubscribe(email, tagName) {
  const tag = await kitPost("/tags", { tag: { name: tagName } });
  const id = tag && tag.tag && tag.tag.id;
  if (id) await kitPost(`/tags/${id}/subscribe`, { email });
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Alleen POST" });
  }

  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  const { email, bedrijf, uitslag, antwoorden } = body || {};

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Vul een geldig e-mailadres in." });
  }
  if (!uitslag || !KLEUREN.has(uitslag.voor) || !KLEUREN.has(uitslag.tijdens) || !KLEUREN.has(uitslag.na)) {
    return res.status(400).json({ error: "Uitslag ontbreekt." });
  }
  if (!Array.isArray(antwoorden) || antwoorden.length !== 9) {
    return res.status(400).json({ error: "Negen antwoorden verwacht." });
  }

  if (!process.env.KIT_API_KEY) {
    // Zonder sleutel wel een nette uitslag tonen, maar niets opslaan.
    console.error("KIT_API_KEY ontbreekt");
    return res.status(200).json({ ok: true, opgeslagen: false });
  }

  const fields = {
    bureaucheck_voor: uitslag.voor,
    bureaucheck_tijdens: uitslag.tijdens,
    bureaucheck_na: uitslag.na,
    bureaucheck_antwoorden: antwoorden.map((a) => String(a).slice(0, 3)).join(","),
  };
  if (bedrijf) fields.bedrijf = String(bedrijf).slice(0, 120);

  try {
    if (process.env.KIT_FORM_ID) {
      await kitPost(`/forms/${process.env.KIT_FORM_ID}/subscribe`, { email, fields });
    }
    await tagSubscribe(email, "bureaucheck");
    await tagSubscribe(email, `bureaucheck-voor-${uitslag.voor}`);
    await tagSubscribe(email, `bureaucheck-tijdens-${uitslag.tijdens}`);
    await tagSubscribe(email, `bureaucheck-na-${uitslag.na}`);
    // Velden meegeven kan alleen via het formulier; zonder KIT_FORM_ID zetten we
    // ze via de tag-inschrijving niet. Daarom hieronder alsnog via subscriber-update
    // als er geen formulier is geconfigureerd.
    if (!process.env.KIT_FORM_ID) {
      const zoek = await fetch(`${KIT}/subscribers?api_secret=${process.env.KIT_API_SECRET || ""}&email_address=${encodeURIComponent(email)}`).then((r) => r.json()).catch(() => null);
      const sub = zoek && zoek.subscribers && zoek.subscribers[0];
      if (sub && process.env.KIT_API_SECRET) {
        await fetch(`${KIT}/subscribers/${sub.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_secret: process.env.KIT_API_SECRET, fields }),
        });
      }
    }
    return res.status(200).json({ ok: true, opgeslagen: true });
  } catch (err) {
    console.error("Kit error:", err);
    return res.status(200).json({ ok: true, opgeslagen: false });
  }
}
