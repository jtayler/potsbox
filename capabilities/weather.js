async function fetchWeather({ call }) {
    const geoUrl =
        `https://geocoding-api.open-meteo.com/v1/search` +
        `?name=${encodeURIComponent(call.city)}` +
        `&count=1&language=en&format=json`;

    const geo = await fetch(geoUrl).then(r => r.json());
    const hit = geo?.results?.[0];
    if (!hit) return {};

    const { latitude, longitude, name, admin1, country } = hit;

    const wxUrl =
        `https://api.open-meteo.com/v1/forecast` +
        `?latitude=${latitude}&longitude=${longitude}` +
        `&current=temperature_2m,wind_speed_10m,precipitation,relative_humidity_2m` +
        `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max` +
        `&hourly=temperature_2m,apparent_temperature,precipitation,wind_speed_10m` +
        `&timezone=America%2FNew_York`;  // Add timezone dynamically

    console.log("fetch weather: ", wxUrl);

    const wx = await fetch(wxUrl).then(r => r.json());
    const cur = wx?.current;
    if (!cur) return {};

    console.log("weather: ", cur);

    return {
        place: [name, admin1, country].filter(Boolean).join(", "),
        temp_f: Math.round(cur.temperature_2m),
        wind_mph: Math.round(cur.wind_speed_10m),
        precipitation_in: cur.precipitation,
        humidity: cur.relative_humidity_2m
    };
}

module.exports = {
    provides: ["place", "temp_f", "wind_mph", "precipitation_in", "humidity"],
    fetch: fetchWeather
};
