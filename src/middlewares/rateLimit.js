const rateLimit = require("express-rate-limit");

// proteccion de los activos de informacion.
// El login Odontologas usa un PIN de 4 a 6 digitos.

function respuestaDemasiadosIntentos(mensaje) {
  return (req, res) => {
    res.status(429).json({ error: mensaje, code: "DEMASIADOS_INTENTOS" });
  };
}

// Login por PIN: es el mas expuesto, por eso el limite mas estricto.
const loginStaffLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutos
  limit: 8,
  skipSuccessfulRequests: true, // solo cuentan los intentos fallidos
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: respuestaDemasiadosIntentos(
    "Demasiados intentos fallidos. Espera 10 minutos e intenta de nuevo."
  ),
});

// Login del panel administrativo (email + password bcrypt): mas resistente por
// si mismo, pero igual se limita para frenar el rociado de credenciales.
const loginAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: respuestaDemasiadosIntentos(
    "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo."
  ),
});

// Limite general para el resto de la API publica (chatbot, disponibilidad),
// pensado para absorber picos y scripts, no para molestar al uso normal.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  handler: respuestaDemasiadosIntentos(
    "Estas enviando demasiadas peticiones. Intenta de nuevo en un momento."
  ),
});

module.exports = { loginStaffLimiter, loginAdminLimiter, apiLimiter };
