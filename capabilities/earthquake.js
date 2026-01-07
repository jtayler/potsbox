async function fetchEarthquake({ call }) {
    try {
        const url =
            "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson";

        const j = await fetch(url).then(r => r.json());
        const f = (j.features || [])
            .filter(e => e?.properties?.mag && e?.properties?.place)
            .sort((a, b) => b.properties.mag - a.properties.mag)[0];

        if (!f) return {};

        return {
            quake_report:
                `Magnitude ${f.properties.mag} earthquake near ${f.properties.place}.`
        };
    } catch {
        return {};
    }
}

module.exports = {
    provides: ["quake_report"],
    fetch: fetchEarthquake
};
