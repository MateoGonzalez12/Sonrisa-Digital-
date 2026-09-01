const prisma = require("../../db/prisma");
const asyncHandler = require("../../utils/asyncHandler");
const { AppError } = require("../../middlewares/errorHandler");
const { comparar, firmarToken } = require("./auth.service");

// Login por email/password
const loginAdmin = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) throw new AppError("Email y contraseña son obligatorios", 400);

  const admin = await prisma.adminUser.findUnique({ where: { email } });
  if (!admin) throw new AppError("Credenciales invalidas", 401);

  const ok = await comparar(password, admin.passwordHash);
  if (!ok) throw new AppError("Credenciales invalidas", 401);

  const token = firmarToken({ id: admin.id, nombre: admin.nombre, rol: "admin" });
  res.json({ token, usuario: { id: admin.id, nombre: admin.nombre, email: admin.email } });
});

// Identificacion simple por nombre + PIN para odontologos/auxiliares, sin
// usuario ni contrasena compleja.
const loginStaff = asyncHandler(async (req, res) => {
  const { odontologoId, pin } = req.body;
  if (!odontologoId || !pin) throw new AppError("Selecciona tu nombre e ingresa tu PIN", 400);

  const staff = await prisma.odontologo.findUnique({ where: { id: Number(odontologoId) } });
  if (!staff || !staff.activo) throw new AppError("PIN incorrecto", 401);

  const bcrypt = require("bcryptjs");
  const ok = await bcrypt.compare(String(pin), staff.pinHash);
  if (!ok) throw new AppError("PIN incorrecto", 401);

  const token = firmarToken(
    { id: staff.id, nombre: staff.nombre, rolStaff: staff.rol, rol: "staff" },
    "12h"
  );
  res.json({ token, usuario: { id: staff.id, nombre: staff.nombre, rol: staff.rol } });
});

// Lista publica de nombres de staff activos para el selector de login del PIN
// (no expone ningun dato sensible).
const listarStaffParaLogin = asyncHandler(async (req, res) => {
  const staff = await prisma.odontologo.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, rol: true },
    orderBy: { nombre: "asc" },
  });
  res.json(staff);
});

module.exports = { loginAdmin, loginStaff, listarStaffParaLogin };
