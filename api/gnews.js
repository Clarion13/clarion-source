export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const GNEWS_KEY = process.env.GNEWS_API_KEY;

  // LEFT-leaning RSS feeds
  const LEFT_FEEDS = [
    { url: "https://feeds.npr.org/1001/rss.xml",                        source: "NPR" },
    { url: "https://www.theguardian.com/us-news/rss",                   source: "The Guardian" },
    { url: "https://feeds.washingtonpost.com/rss/national",             source: "Washington Post" },
    { url: "https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml", source: "New York Times" },
    { url: "https://www.huffpost.com/section/front-page/feed",          source: "HuffPost" },
  ];

  // CENTER RSS feeds
  const CENTER_FEEDS = [
    { url: "https://feeds.bbci.co.uk/news/rss.xml",                    source: "BBC News" },
    { url: "https://apnews.com/rss/apf-topnews",                       source: "AP News" },
  ];

  // RIGHT-leaning RSS feeds
  const RIGHT_FEEDS = [
    { url: "https://feeds.foxnews.com/foxnews/latest",                  source: "Fox News" },
    { url: "https://nypost.com/feed/",                                  source: "NY Post" },
    { url: "https://www.washingtonexaminer.com/feed",                   source: "Washington Examiner" },
    { url: "https://www.dailywire.com/feeds/rss.xml",                   source: "Daily Wire" },
  ];

  function extractImage(item) {
    // 1. media:content with largest width
    const mediaMatches = [...(item.matchAll(/<media:content[^>]+url=["']([^"']+)["'][^>]*/gi) || [])];
    const candidates = [];
    mediaMatches.forEach(m => {
      const url = m[1];
      const w = parseInt(m[0].match(/width=["']?(\d+)/i)?.[1] || "500");
      if (url.match(/\.(jpg|jpeg|png|webp)/i)) candidates.push({ url, w });
    });
    if (candidates.length) {
      candidates.sort((a, b) => b.w - a.w);
      return candidates[0].url;
    }
    // 2. media:thumbnail
    const thumb = item.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i)?.[1];
    if (thumb && thumb.match(/\.(jpg|jpeg|png|webp)/i)) return thumb;
    // 3. enclosure
    const enc = item.match(/<enclosure[^>]+url=["']([^"']+)["'][^>]+type=["']image/i)?.[1];
    if (enc) return enc;
    // 4. Any image in content:encoded or description
    const block = item.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)?.[1] ||
                  item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "";
    const imgUrl = block.match(/https?:\/\/[^\s"'<>]+\.(?:jpg|jpeg|png|webp)(?:\?[^\s"'<>]*)?/i)?.[0];
    if (imgUrl) return imgUrl;
    return null;
  }

  function parseRSS(xml, sourceName) {
    const items = [];
    const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
    itemMatches.slice(0, 8).forEach(item => {
      const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                     item.match(/<title>(.*?)<\/title>/))?.[1]?.trim();
      const link  = (item.match(/<link>(.*?)<\/link>/) ||
                     item.match(/<guid>(https?[^<]+)<\/guid>/))?.[1]?.trim();
      const desc  = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                     item.match(/<description>(.*?)<\/description>/))?.[1]
                    ?.replace(/<[^>]+>/g, "").trim().slice(0, 200);
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1]?.trim();
      const image = extractImage(item);
      if (title && link && !title.includes("<?xml")) {
        items.push({
          title, url: link, description: desc || "",
          publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
          image, source: { name: sourceName }
        });
      }
    });
    return items;
  }

  async function fetchFeeds(feeds) {
    const results = await Promise.all(
      feeds.map(f =>
        fetch(f.url, { headers: { "User-Agent": "Mozilla/5.0" } })
          .then(r => r.text()).then(xml => parseRSS(xml, f.source)).catch(() => [])
      )
    );
    return results.flat();
  }

  // Fetch GNews categories (always has images)
  async function fetchGNews() {
    if (!GNEWS_KEY) return [];
    const categories = ["general", "politics", "technology", "business", "world"];
    const results = await Promise.all(
      categories.map(cat =>
        fetch(`https://gnews.io/api/v4/top-headlines?category=${cat}&lang=en&country=us&max=8&apikey=${GNEWS_KEY}`)
          .then(r => r.json()).then(d => d.articles || []).catch(() => [])
      )
    );
    return results.flat().map(a => ({
      title: a.title,
      url: a.url,
      description: a.description || "",
      publishedAt: a.publishedAt || new Date().toISOString(),
      image: a.image || null,   // GNews always includes article images
      source: { name: a.source?.name || "Unknown" }
    }));
  }

  try {
    const [gnewsArticles, leftArticles, centerArticles, rightArticles] = await Promise.all([
      fetchGNews(),
      fetchFeeds(LEFT_FEEDS),
      fetchFeeds(CENTER_FEEDS),
      fetchFeeds(RIGHT_FEEDS),
    ]);

    // GNews gives us center/mainstream sources with images — cap at 15
    // Balance RSS left/right at ~10 each
    const combined = [
      ...gnewsArticles.slice(0, 15),
      ...leftArticles.slice(0, 10),
      ...centerArticles.slice(0, 8),
      ...rightArticles.slice(0, 10),
    ];

    // Shuffle so leaning sources are interleaved
    for (let i = combined.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [combined[i], combined[j]] = [combined[j], combined[i]];
    }

    // Deduplicate by URL
    const seen = new Set();
    const articles = combined.filter(a => {
      if (!a.title || !a.url || seen.has(a.url)) return false;
      seen.add(a.url);
      return true;
    });

    return res.status(200).json({ articles, totalArticles: articles.length });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
