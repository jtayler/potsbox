async function fetchNasa({ call }) {
    try {
        const url = "https://eonet.gsfc.nasa.gov/api/v3/events?limit=1";
        const j = await fetch(url).then(r => r.json());

        const e = j?.events?.[0];
        if (!e) return {};

        return {
            nasa_event:
                `${e.title}. Category: ${e.categories?.[0]?.title || "space event"}.`
        };
    } catch {
        return {};
    }
}

module.exports = {
    provides: ["nasa_event"],
    fetch: fetchNasa
};
