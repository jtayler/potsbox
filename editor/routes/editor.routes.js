const express = require("express");
const router = express.Router();
const pool = require("../../db/pool"); // adjust if needed

// GET /editor - List of lines and services
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `
      SELECT id, type, name, dial_code, note
      FROM endpoints
      WHERE owner_id = ?
      ORDER BY type, name
      `,
      [1] // your user ID
    );

    const lines = rows.filter(r => r.type === "line");
    const services = rows.filter(r => r.type === "service");

    res.render("index", { lines, services });
  } catch (err) {
    console.error("Editor load failed:", err);
    res.status(500).send("Editor error");
  }
});

// GET /editor/line/:id - Line editor form
router.get("/line/:id", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM endpoints WHERE id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).send("Line not found");
    }

    const line = rows[0];
    res.render("line-edit", { line });
  } catch (err) {
    console.error("Error loading line edit form:", err);
    res.status(500).send("Error loading line form");
  }
});

// POST /editor/line/:id - Update line
router.post("/line/:id", async (req, res) => {
  console.log(req.body);  // Log the body to check if it contains the data you need
  const { name, dial_code, note } = req.body; // Extract the form fields
  
  try {
    // Update the line in the database
    await pool.execute(
      `
      UPDATE endpoints
      SET name = ?, note = ?, dial_code = ?
      WHERE id = ?
      `,
      [name, note, dial_code, req.params.id] // Use `id` from the URL params
    );

    res.redirect("/editor"); // Redirect to the editor page after saving
  } catch (err) {
    console.error("Error updating line:", err);
    res.status(500).send("Error updating line");
  }
});

// GET /editor/service/:id - Service editor form
router.get("/service/:id", async (req, res) => {
  console.log(req.body);  // Log the body to check if it contains the data you need
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM endpoints WHERE id = ?`,
      [req.params.id]
    );

    if (rows.length === 0) {
      return res.status(404).send("Service not found");
    }

    const service = rows[0];
    res.render("service-edit", { service });
  } catch (err) {
    console.error("Error loading service edit form:", err);
    res.status(500).send("Error loading service form");
  }
});

// POST /editor/service/:id - Update service
router.post("/service/:id", async (req, res) => {
  let { name, note, dial_code, voice, requires, opener, closer } = req.body;

  // Transform 'requires' properly
  let bodRequires = req.body.requires;
  if (bodRequires === 'none' || !bodRequires) {
    requires = []; // If 'none' or undefined, make it an empty array
  } else {
    requires = [bodRequires]; // Otherwise, wrap it in an array
  }

  // Convert 'requires' array to JSON string
  const requiresJson = JSON.stringify(requires);

  try {
    await pool.execute(
      `
      UPDATE endpoints
      SET name = ?, note = ?, dial_code = ?, voice = ?, requires = ?, opener = ?, closer = ?
      WHERE id = ?
      `,
      [name, note, dial_code, voice, requiresJson, opener, closer, req.params.id]
    );

    res.redirect("/editor"); // Redirect back to the editor page
  } catch (err) {
    console.error("Error updating service:", err);
    res.status(500).send("Error updating service");
  }
});

module.exports = router;
