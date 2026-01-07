async function fetchOnThisDay({ call }) {
    try {
        const date = call.now;
        const m = String(date.month).padStart(2, "0");
        const d = String(date.day).padStart(2, "0");

        const url =
            `https://en.wikipedia.org/api/rest_v1/feed/onthisday/events/${m}/${d}`;

        const j = await fetch(url, {
            headers: { "User-Agent": "PotsBox/1.0 (on-this-day)" }
        }).then(r => {
            if (!r.ok) throw new Error(`WIKI_${r.status}`);
            return r.json();
        });

        const events = (j?.events || []).filter(e => e?.year && e?.text);
        if (!events.length) return {};

        const pool = events.filter(e => e.year >= 1900);
        const use = pool.length ? pool : events;

        const pick = () => use[Math.floor(Math.random() * use.length)];
        const clean = s =>
            String(s || "")
                .replace(/\s+/g, " ")
                .replace(/\[[^\]]*\]/g, "")
                .trim();

        const a = pick();
        let b = pick();
        for (let i = 0; i < 10 && b === a; i++) b = pick();

        const lines = [a, b].map(
            e => `On this day in ${e.year}, ${clean(e.text)}`
        );

        return {
            history_items: lines.join(" ")
        };
    } catch {
        return {};
    }
}

module.exports = {
    provides: ["history_items"],
    fetch: fetchOnThisDay
};
