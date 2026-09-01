// Manejo centralizado de errores (confiabilidad ante fallas) para que
// ningun modulo tenga que reimplementar su propio formato de respuesta de error.
class AppError extends Error {
  constructor(message, statusCode = 400, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

function notFoundHandler(req, res, next) {
  next(new AppError(`Ruta no encontrada: ${req.method} ${req.originalUrl}`, 404));
}

function errorHandler(err, req, res, next) { // eslint-disable-line no-unused-vars
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    console.error("[error]", err);
  }

  // Violacion de restriccion unica de Prisma (ej. doble reserva del mismo horario)
  if (err.code === "P2002") {
    return res.status(409).json({
      error: "Ese horario ya no esta disponible. Por favor elige otro.",
      code: "HORARIO_NO_DISPONIBLE",
    });
  }

  res.status(statusCode).json({
    error: err.message || "Error interno del servidor",
    details: err.details,
  });
}

module.exports = { AppError, notFoundHandler, errorHandler };
