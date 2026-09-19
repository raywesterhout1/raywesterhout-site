// Vercel serverless function: ontvangt de uitslag van de Bureaucheck en zet de
// inzender in Kit (formulier + tags + velden). Zelfde aanpak als
// horeca-ai-score/src/lib/kit.ts, maar zonder framework.
//
// Omgevingsvariabelen (Vercel project raywesterhout-site):
//   KIT_API_KEY   verplicht
//   KIT_FORM_ID   optioneel, formulier waarop wordt ingeschreven (velden gaan ook zonder formulier mee via de tag)

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

// Kit v3: POST /tags geeft bij een nieuwe tag {id, name} op het hoogste niveau
// en bij een bestaande tag een 422 "Name has already been taken". Daarom eerst
// opzoeken in de lijst, en pas aanmaken als hij er niet is.
let tagCache = null;
async function tagId(naam) {
  if (!tagCache) {
    const lijst = await fetch(`${KIT}/tags?api_key=${process.env.KIT_API_KEY}`).then((r) => r.json()).catch(() => ({}));
    tagCache = new Map((lijst.tags || []).map((t) => [t.name, t.id]));
  }
  if (tagCache.has(naam)) return tagCache.get(naam);
  const nieuw = await kitPost("/tags", { tag: { name: naam } });
  const id = nieuw && (nieuw.id || (nieuw.tag && nieuw.tag.id));
  if (id) tagCache.set(naam, id);
  return id || null;
}

// Inschrijven op een tag; velden mogen hier direct mee (net als bij een formulier).
async function tagSubscribe(email, naam, fields) {
  const id = await tagId(naam);
  if (!id) return false;
  const r = await kitPost(`/tags/${id}/subscribe`, { email, ...(fields && { fields }) });
  return Boolean(r && r.subscription);
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
    // De velden gaan mee op de hoofdtag; de kleurtags alleen voor segmentatie.
    const ok = await tagSubscribe(email, "bureaucheck", fields);
    await tagSubscribe(email, `bureaucheck-voor-${uitslag.voor}`);
    await tagSubscribe(email, `bureaucheck-tijdens-${uitslag.tijdens}`);
    await tagSubscribe(email, `bureaucheck-na-${uitslag.na}`);
    return res.status(200).json({ ok: true, opgeslagen: ok });
  } catch (err) {
    console.error("Kit error:", err);
    return res.status(200).json({ ok: true, opgeslagen: false });
  }
}
