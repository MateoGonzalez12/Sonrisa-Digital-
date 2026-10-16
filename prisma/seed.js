// Carga los datos iniciales usando la informacion que ya traia el boceto
// (procedimientos, horario de atencion, profesional a cargo).
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

const PROCEDIMIENTOS = [
  {
    nombre: "Limpieza dental",
    descripcion: "Eliminamos placa y sarro con tecnologia ultrasonica indolora y pulido especializado para proteger tus encias.",
    duracionMin: 30,
    precio: null,
  },
  {
    nombre: "Ortodoncia",
    descripcion: "Alinea tu sonrisa con brackets esteticos o alineadores transparentes, con un plan a tu medida.",
    duracionMin: 30,
    precio: null,
  },
  {
    nombre: "Implantes dentales",
    descripcion: "Reemplaza piezas perdidas con una fijacion de titanio biocompatible y una corona hecha a medida.",
    duracionMin: 40,
    precio: null,
  },
  {
    nombre: "Coronas",
    descripcion: "Restauramos la fuerza, forma y belleza de tus dientes con coronas personalizadas de alta resistencia.",
    duracionMin: 30,
    precio: null,
  },
];

async function main() {
  console.log("Sembrando datos iniciales...");

  for (const p of PROCEDIMIENTOS) {
    await prisma.procedimiento.upsert({
      where: { id: PROCEDIMIENTOS.indexOf(p) + 1 },
      update: {},
      create: p,
    });
  }

  const pinDraLyda = await bcrypt.hash("1234", 10);
  const draLyda = await prisma.odontologo.upsert({
    where: { id: 1 },
    update: {},
    create: { nombre: "Dra. Lyda P. Gonzalez Angulo", rol: "ODONTOLOGO", pinHash: pinDraLyda },
  });

  const pinAuxiliar = await bcrypt.hash("5678", 10);
  await prisma.odontologo.upsert({
    where: { id: 2 },
    update: {},
    create: { nombre: "Auxiliar Odontologia", rol: "AUXILIAR", pinHash: pinAuxiliar },
  });

  // Horario de atencion tomado del boceto: L-V 8:00-18:00, Sabado 8:00-12:00
  const horarioExistente = await prisma.horarioOdontologo.findFirst({ where: { odontologoId: draLyda.id } });
  if (!horarioExistente) {
    await prisma.horarioOdontologo.createMany({
      data: [
        { odontologoId: draLyda.id, diaSemana: 1, horaInicio: "08:00", horaFin: "18:00" },
        { odontologoId: draLyda.id, diaSemana: 2, horaInicio: "08:00", horaFin: "18:00" },
        { odontologoId: draLyda.id, diaSemana: 3, horaInicio: "08:00", horaFin: "18:00" },
        { odontologoId: draLyda.id, diaSemana: 4, horaInicio: "08:00", horaFin: "18:00" },
        { odontologoId: draLyda.id, diaSemana: 5, horaInicio: "08:00", horaFin: "18:00" },
        { odontologoId: draLyda.id, diaSemana: 6, horaInicio: "08:00", horaFin: "12:00" },
      ],
    });
  }

  const passwordAdmin = await bcrypt.hash("SonrisaDigital2026", 10);
  await prisma.adminUser.upsert({
    where: { email: "admin@sonrisadigital.com" },
    update: {},
    create: { nombre: "Administrador Consultorio", email: "admin@sonrisadigital.com", passwordHash: passwordAdmin },
  });

  console.log("Listo. Credenciales de prueba:");
  console.log("  Admin  -> admin@sonrisadigital.com / SonrisaDigital2026");
  console.log("  Staff  -> Dra. Lyda P. Gonzalez Angulo / PIN 1234");
  console.log("  Staff  -> Auxiliar Odontologia / PIN 5678");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
