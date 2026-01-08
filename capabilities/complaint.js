// ./capabilities/complaint.js
async function fetchComplaint() {
  const url =
    "https://data.cityofnewyork.us/resource/erm2-nwe9.json" +
    "?$limit=1" +
    "&$order=created_date DESC";

  const j = await fetch(url).then(r => r.json());
  const c = j?.[0];
  if (!c) return {};

  return {
    complaint:
      `${c.complaint_type}${c.borough ? " in " + c.borough : ""}`
  };
}

module.exports = {
  provides: ["complaint"],
  fetch: fetchComplaint
};
