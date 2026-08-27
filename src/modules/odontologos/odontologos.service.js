const bcrypt = require("bcryptjs");
const prisma = require("../../db/prisma");
const { AppError } = require("../../middlewares/errorHandler");

// RF-24: gestionar odontologos y auxiliares
async function listar({ soloActivos = false } = {}) {
  return prisma.odontologo.findMany({
    where: soloActivos ? { activo: true } : undefined,
    select: {
      id: true,
      nombre: true,
      rol: true,
      activo: true,
      createdAt: true,
      horarios: true,
    },
    orderBy: { nombre: "asc" },
  });
}

async function obtener(id) {
  const o = await prisma.odontologo.findUnique({
    where: { id: Number(id) },
    include: { horarios: true, bloqueos: true },
  });
  if (!o) throw new AppError("Odontologo/auxiliar no encontrado", 404);
  return o;
}

async function crear({ nombre, rol, pin }) {
  if (!nombre || !pin) throw new AppError("Nombre y PIN son obligatorios", 400);
  if (!/^\d{4,6}$/.test(String(pin))) {
    throw new AppError("El PIN debe tener entre 4 y 6 digitos numericos", 400);
  }
  const pinHash = await bcrypt.hash(String(pin), 10);
  return prisma.odontologo.create({
    data: { nombre, rol: rol === "AUXILIAR" ? "AUXILIAR" : "ODONTOLOGO", pinHash },
  });
}

async function actualizar(id, { nombre, rol, pin, activo }) {
  await obtener(id);
  const data = { nombre, rol, activo };
  if (pin) {
    if (!/^\d{4,6}$/.test(String(pin))) {
      throw new AppError("El PIN debe tener entre 4 y 6 digitos numericos", 400);
    }
    data.pinHash = await bcrypt.hash(String(pin), 10);
  }
  return prisma.odontologo.update({ where: { id: Number(id) }, data });
}

// KAN-71: un odontologo/auxiliar eliminado deja de aparecer como opcion en la
// configuracion de horarios (soft-delete via activo=false, preserva historial
// de citas ya asociadas a el).
async function eliminar(id) {
  await obtener(id);
  return prisma.odontologo.update({ where: { id: Number(id) }, data: { activo: false } });
}

// RF-20: cada odontologo puede tener horarios distintos entre si (KAN-58).
// Reemplaza el set completo de horarios semanales del odontologo.
async function establecerHorarios(odontologoId, horarios) {
  await obtener(odontologoId);
  const id = Number(odontologoId);

  return prisma.$transaction(async (tx) => {
    await tx.horarioOdontologo.deleteMany({ where: { odontologoId: id } });
    if (horarios.length) {
      await tx.horarioOdontologo.createMany({
        data: horarios.map((h) => ({
          odontologoId: id,
          diaSemana: Number(h.diaSemana),
          horaInicio: h.horaInicio,
          horaFin: h.horaFin,
        })),
      });
    }
    return tx.horarioOdontologo.findMany({ where: { odontologoId: id } });
  });
}

// RF-21: bloquear horarios no disponibles (vacaciones, permisos, etc.)
// KAN-111: el bloqueo puede aplicarse a un odontologo especifico sin afectar
// a los demas (odontologoId null = bloqueo general del consultorio).
async function crearBloqueo({ odontologoId, inicio, fin, motivo }) {
  if (!inicio || !fin) throw new AppError("Debes indicar inicio y fin del bloqueo", 400);
  const inicioDate = new Date(inicio);
  const finDate = new Date(fin);
  if (finDate <= inicioDate) throw new AppError("El fin del bloqueo debe ser posterior al inicio", 400);

  return prisma.bloqueoHorario.create({
    data: {
      odontologoId: odontologoId ? Number(odontologoId) : null,
      inicio: inicioDate,
      fin: finDate,
      motivo: motivo || null,
    },
  });
}

async function listarBloqueos(odontologoId) {
  return prisma.bloqueoHorario.findMany({
    where: odontologoId ? { odontologoId: Number(odontologoId) } : undefined,
    orderBy: { inicio: "asc" },
  });
}

async function eliminarBloqueo(id) {
  return prisma.bloqueoHorario.delete({ where: { id: Number(id) } });
}

module.exports = {
  listar,
  obtener,
  crear,
  actualizar,
  eliminar,
  establecerHorarios,
  crearBloqueo,
  listarBloqueos,
  eliminarBloqueo,
};
