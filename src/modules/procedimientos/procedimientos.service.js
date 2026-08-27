const prisma = require("../../db/prisma");
const { AppError } = require("../../middlewares/errorHandler");

async function listar({ soloActivos = false } = {}) {
  return prisma.procedimiento.findMany({
    where: soloActivos ? { activo: true } : undefined,
    orderBy: { nombre: "asc" },
  });
}

async function obtener(id) {
  const p = await prisma.procedimiento.findUnique({ where: { id: Number(id) } });
  if (!p) throw new AppError("Procedimiento no encontrado", 404);
  return p;
}

async function crear(datos) {
  return prisma.procedimiento.create({
    data: {
      nombre: datos.nombre,
      descripcion: datos.descripcion || null,
      duracionMin: Number(datos.duracionMin) || 30,
      precio: datos.precio ?? null,
      activo: datos.activo ?? true,
    },
  });
}

async function actualizar(id, datos) {
  await obtener(id);
  return prisma.procedimiento.update({
    where: { id: Number(id) },
    data: {
      nombre: datos.nombre,
      descripcion: datos.descripcion,
      duracionMin: datos.duracionMin ? Number(datos.duracionMin) : undefined,
      precio: datos.precio,
      activo: datos.activo,
    },
  });
}

// KAN-53: no permitir eliminar un procedimiento con citas futuras activas sin
// advertencia previa. Por defecto solo se desactiva (soft delete); "forzar"
// se usa cuando el admin ya confirmo la advertencia.
async function eliminar(id, { forzar = false } = {}) {
  await obtener(id);
  const citasFuturasActivas = await prisma.cita.count({
    where: {
      procedimientoId: Number(id),
      fechaHora: { gte: new Date() },
      estado: { in: ["PENDIENTE", "CONFIRMADA"] },
    },
  });

  if (citasFuturasActivas > 0 && !forzar) {
    return {
      eliminado: false,
      advertencia: `Este procedimiento tiene ${citasFuturasActivas} cita(s) futura(s) activa(s). Vuelve a intentarlo confirmando la advertencia si de todas formas quieres desactivarlo.`,
      citasFuturasActivas,
    };
  }

  const actualizado = await prisma.procedimiento.update({
    where: { id: Number(id) },
    data: { activo: false },
  });
  return { eliminado: true, procedimiento: actualizado };
}

module.exports = { listar, obtener, crear, actualizar, eliminar };
