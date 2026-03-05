export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Missing query" });

  const key = process.env.PIXABAY_API_KEY;
  if (!key) return res.status(500).json({ error: "Missing PIXABAY_API_KEY" });

  try {
    const r = await fetch(
      `https://pixabay.com/api/?key=${key}&q=${encodeURIComponent(q)}&image_type=photo&orientation=horizontal&min_width=1200&min_height=600&per_page=5&safesearch=true&editors_choice=false`
    );
    const data = await r.json();
    const hits = data.hits || [];

    if (!hits.length) return res.status(404).json({ image: null });

    // Pick the highest resolution image available
    const best = hits[0];
    const image = best.largeImageURL || best.webformatURL;
    return res.status(200).json({ image });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
