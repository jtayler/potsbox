const pool = require("./pool");

async function findEndpoint({ ownerId, dialCode }) {
  const [rows] = await pool.execute(
    `SELECT * FROM endpoints
     WHERE owner_id = ?
       AND dial_code = ?
     LIMIT 1`,
    [ownerId, dialCode]
  );
  return rows[0] || null;
}

async function ownerFromSipUser(sipUserId) {
  const [rows] = await pool.execute(
    `SELECT owner_id FROM endpoints
     WHERE sip_user_id = ?
     LIMIT 1`,
    [sipUserId]
  );
  return rows[0]?.owner_id || null;
}

module.exports = {
  findEndpoint,
  ownerFromSipUser,
};
