const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const env = require("../../config/env");

const SALT_ROUNDS = 10;

async function hash(valor) {
  return bcrypt.hash(valor, SALT_ROUNDS);
}

async function comparar(valor, hashGuardado) {
  return bcrypt.compare(valor, hashGuardado);
}

function firmarToken(payload, expiresIn = "8h") {
  return jwt.sign(payload, env.jwtSecret, { expiresIn });
}

function verificarToken(token) {
  return jwt.verify(token, env.jwtSecret);
}

module.exports = { hash, comparar, firmarToken, verificarToken };
