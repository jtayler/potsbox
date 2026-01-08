async function fetchSpace({ call }) {
  const rss = await fetch("https://www.jpl.nasa.gov/rss/news")
    .then(r => r.text());

  const item = rss.match(
    /<title><!\[CDATA\[(.*?)\]\]><\/title>[\s\S]*?<description><!\[CDATA\[(.*?)\]\]>/i
  );

  if (!item) return {};

  return {
    space_event: `${item[1]}. ${item[2].replace(/<[^>]+>/g, "").trim()}`
  };
}

module.exports = {
  provides: ["space_event"],
  fetch: fetchSpace
};
