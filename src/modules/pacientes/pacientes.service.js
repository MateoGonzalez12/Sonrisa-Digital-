const prisma = require("../../db/prisma");
const { AppError } = require("../../middlewares/errorHandler");

// RF-16: el paciente queda registrado solo con nombre y cedula, sin cuenta ni
// contrasena (KAN-50). Si la cedula ya existe, reutiliza el registro (y
// actualiza el nombre/telefono si vinieron mas completos).
async function buscarOCrearPaciente({ nombre, cedula, telefono }) {
  const cedulaLimpia = String(cedula || "").trim();
  const nombreLimpio = String(nombre || "").trim();

  // KAN-51: no es posible crear una cita sin nombre y cedula validos.
  if (!cedulaLimpia || cedulaLimpia.length < 5) {
    throw new AppError("La cedula ingresada no es valida.", 400);
  }
  if (!nombreLimpio || nombreLimpio.length < 3) {
    throw new AppError("El nombre ingresado no es valido.", 400);
  }

  const existente = await prisma.paciente.findUnique({ where: { cedula: cedulaLimpia } });
  if (existente) {
    if (telefono && !existente.telefono) {
      return prisma.paciente.update({ where: { id: existente.id }, data: { telefono } });
    }
    return existente;
  }

  return prisma.paciente.create({
    data: { nombre: nombreLimpio, cedula: cedulaLimpia, telefono: telefono || null },
  });
}

// RF-17: busca por cedula exacta o por nombre (insensible a mayusculas/minusculas
// - KAN-84).
async function buscarPacientes(termino) {
  const q = String(termino || "").trim();
  if (!q) return [];

  return prisma.paciente.findMany({
    where: {
      OR: [
        { cedula: { contains: q } },
        { nombre: { contains: q, mode: "insensitive" } },
      ],
    },
    orderBy: { nombre: "asc" },
    take: 25,
  });
}

// RF-18: historial completo (pasado y futuro) de citas de un paciente por cedula.
async function historialPorCedula(cedula) {
  const paciente = await prisma.paciente.findUnique({
    where: { cedula: String(cedula).trim() },
    include: {
      citas: {
        include: { procedimiento: true, odontologo: true },
        orderBy: { fechaHora: "desc" },
      },
    },
  });
  if (!paciente) throw new AppError("No se encontro ningun paciente con esa cedula.", 404);
  return paciente;
}

module.exports = { buscarOCrearPaciente, buscarPacientes, historialPorCedula };
