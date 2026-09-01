const { verificarToken } = require("./auth.service");
const { AppError } = require("../../middlewares/errorHandler");

function extraerToken(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7);
  return null;
}

// Separa el acceso segun el tipo de usuario (admin vs staff movil).
function requireRol(rolEsperado) {
  return function (req, res, next) {
    const token = extraerToken(req);
    if (!token) return next(new AppError("No autenticado", 401));
    try {
      const payload = verificarToken(token);
      if (rolEsperado && payload.rol !== rolEsperado) {
        return next(new AppError("No autorizado para este modulo", 403));
      }
      req.usuario = payload;
      next();
    } catch (err) {
      next(new AppError("Sesion invalida o expirada", 401));
    }
  };
}

module.exports = { requireRol };
