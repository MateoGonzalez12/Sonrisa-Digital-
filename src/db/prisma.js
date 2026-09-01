const { PrismaClient } = require("@prisma/client");

// Cliente unico de Prisma compartido por todos los modulos (modularidad,
// cada modulo importa solo esta conexion, nunca crea la suya propia).
const prisma = new PrismaClient();

module.exports = prisma;
