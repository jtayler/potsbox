const express = require("express");
const router = express.Router();
const pool = require("../../db/pool"); // adjust if needed

// --- helper: letters -> phone digits (Q, Z excluded)
function toDialDigits(input = "") {
  const map = {
    A:2,B:2,C:2,
    D:3,E:3,F:3,
    G:4,H:4,I:4,
    J:5,K:5,L:5,
    M:6,N:6,O:6,
    P:7,R:7,S:7,
    T:8,U:8,V:8,
    W:9,X:9,Y:9,
  };

  return input
    .toUpperCase()
    .replace(/[^A-Y0-9]/g, "")
    .replace(/[A-Y]/g, ch => map[ch]);
}

// GET /editor - List of lines and services
router.get("/", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `
      SELECT *
      FROM endpoints
      WHERE owner_id = ?
      ORDER BY type, updated_at DESC
      `,
      [1]
    );

    const lines = rows.filter(r => r.type === "line");
    const services = rows.filter(r => r.type === "service");

    res.render("index", { lines, services });
  } catch (err) {
    console.error("Editor load failed:", err);
    res.status(500).send("Editor error");
  }
});

// POST /editor/line/:id - Update line (UNCHANGED)
router.post("/line/:id", async (req, res) => {
  const { name, dial_code, note } = req.body;

  try {
    await pool.execute(
      `
      UPDATE endpoints
      SET
        name = ?,
        dial_code = ?,
        note = ?
      WHERE id = ?
      `,
      [name, dial_code, note, req.params.id]
    );

    res.redirect("/editor");
  } catch (err) {
    console.error("Error updating line:", err);
    res.status(500).send("Error updating line");
  }
});

// GET /editor/line/:id
router.get("/line/:id", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM endpoints WHERE id = ?`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).send("Line not found");

    res.render("line-edit", { line: rows[0] });
  } catch (err) {
    console.error("Error loading line edit form:", err);
    res.status(500).send("Error loading line form");
  }
});

// GET /editor/service/:id
router.get("/service/:id", async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT * FROM endpoints WHERE id = ?`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).send("Service not found");

    res.render("service-edit", { service: rows[0] });
  } catch (err) {
    console.error("Error loading service edit form:", err);
    res.status(500).send("Error loading service form");
  }
});

// POST /editor/service/:id - Update service (UPDATED)
router.post("/service/:id", async (req, res) => {
  let {
    name,
    note = null,
    dial_code = null,
    dial_alias = null,
    voice = null,
    opener = null,
    content = null,
    closer = null
  } = req.body;

  const is_loop = req.body.is_loop ? 1 : 0;

  // --- requires: always store JSON array
  let requiresArr = [];
  if (req.body.requires && req.body.requires !== "none") {
    requiresArr = Array.isArray(req.body.requires)
      ? req.body.requires
      : [req.body.requires];
  }
  const requiresJson = JSON.stringify(requiresArr);

  // --- alias -> digits (services only)
  const alias = dial_alias ? dial_alias.toUpperCase() : null;
  const finalDialCode = alias ? toDialDigits(alias) : dial_code;

  try {
    await pool.execute(
      `
      UPDATE endpoints
      SET
        name = ?,
        note = ?,
        dial_code = ?,
        dial_alias = ?,
        voice = ?,
        requires = ?,
        is_loop = ?,
        opener = ?,
        content = ?,
        closer = ?
      WHERE id = ?
      `,
      [
        name,
        note,
        finalDialCode,
        alias,
        voice,
        requiresJson,
        is_loop,
        opener,
        content,
        closer,
        req.params.id
      ]
    );

    res.redirect("/editor");
  } catch (err) {
    console.error("Error updating service:", err);
    res.status(500).send("Error updating service");
  }
});

module.exports = router;
