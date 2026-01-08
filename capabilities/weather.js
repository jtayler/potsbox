// ./capabilities/weather.js

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
        `&current=temperature_2m,wind_speed_10m,precipitation` +
        `&temperature_unit=fahrenheit&wind_speed_unit=mph`;

console.log("fetch weather: ", wxUrl);

    const wx = await fetch(wxUrl).then(r => r.json());
    const cur = wx?.current;
    if (!cur) return {};

console.log("weather: ", cur);

    return {
        place: [name, admin1, country].filter(Boolean).join(", "),
        temp_f: Math.round(cur.temperature_2m),
        wind_mph: Math.round(cur.wind_speed_10m),
        precipitation_in: cur.precipitation
    };
}

module.exports = {
    provides: ["place", "temp_f", "wind_mph", "precipitation_in"],
    fetch: fetchWeather
};
