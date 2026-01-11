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
  `&temperature_unit=fahrenheit&current=temperature_2m,wind_speed_10m,precipitation,weathercode
&hourly=snowfall,precipitation,temperature_2m
&daily=snowfall_sum,snow_depth_max` +
  `&wind_speed_unit=mph` +
  `&precipitation_unit=inch` +
  `&timezone=America%2FNew_York`;

    console.log("fetch weather: ", wxUrl);

    const wx = await fetch(wxUrl).then(r => r.json());
    const cur = wx?.current;
    if (!cur) return {};

    console.log("weather: ", cur);

console.log("WEATHER RAW:", wx);
console.log("WEATHER CURRENT:", cur);

const nowIndex = wx.hourly.time.indexOf(cur.time);

const next6h = wx.hourly.temperature_2m
  .slice(nowIndex, nowIndex + 6);

return {
  // --- current ---
  place: [name, admin1, country].filter(Boolean).join(", "),
  temp_f: Math.round(cur.temperature_2m),
  wind_mph: Math.round(cur.wind_speed_10m),
  precipitation_in: +cur.precipitation.toFixed(2),
  snowfall_in: nowIndex >= 0
    ? +wx.hourly.snowfall[nowIndex].toFixed(2)
    : 0,
  humidity: cur.relative_humidity_2m,
  weathercode: cur.weathercode,

  // --- short forecast ---
  temp_next_6h_min: Math.min(...next6h),
  temp_next_6h_max: Math.max(...next6h),

  // --- daily forecast ---
  snow_today_in: +wx.daily.snowfall_sum[0].toFixed(2),
  snow_depth_today_ft: +wx.daily.snow_depth_max[0].toFixed(3)
};

}

module.exports = {
  provides: [
    "place",
    "temp_f",
    "wind_mph",
    "precipitation_in",
    "snowfall_in",
    "humidity",
    "weathercode",
    "temp_next_6h_min",
    "temp_next_6h_max",
    "snow_today_in",
    "snow_depth_today_ft"
  ],
  fetch: fetchWeather
};
