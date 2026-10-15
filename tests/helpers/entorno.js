// Entorno aislado para las pruebas: se carga ANTES que cualquier modulo de src/.
//  - Fija variables de entorno de prueba (dotenv no pisa las que ya existen).
//  - Sustituye el cliente de Prisma por uno falso en memoria, de modo que ninguna
//    prueba toca la base real ni manda WhatsApp o push de verdad.
const path = require("path");

process.env.DATABASE_URL = "postgresql://nadie:nada@invalid.localhost:5432/prueba";
process.env.JWT_SECRET = "secreto-solo-para-pruebas";
process.env.WHATSAPP_PROVIDER = "simulado";
process.env.META_APP_SECRET = "secreto-meta-de-pruebas";
process.env.META_WEBHOOK_VERIFY_TOKEN = "token-verificacion-pruebas";
process.env.VAPID_PUBLIC_KEY = "";
process.env.VAPID_PRIVATE_KEY = "";
process.env.TZ = "America/Bogota";

// Prisma falso: cada metodo se define con prisma.definir("cita.findMany", fn).
// Si el codigo llama a algo sin definir, la prueba falla con un mensaje claro en
// vez de intentar conectarse a una base.
function crearPrismaFalso() {
  const implementaciones = new Map();
  const llamadas = [];

  const modelo = (nombre) =>
    new Proxy(
      {},
      {
        get: (_, metodo) => {
          if (typeof metodo === "symbol" || metodo === "then") return undefined;
          return async (args) => {
            const clave = `${nombre}.${metodo}`;
            llamadas.push({ clave, args });
            const fn = implementaciones.get(clave);
            if (!fn) throw new Error(`Prisma falso: falta definir ${clave}`);
            return fn(args);
          };
        },
      }
    );

  return new Proxy(
    {},
    {
      get: (_, nombre) => {
        if (typeof nombre === "symbol" || nombre === "then") return undefined;
        if (nombre === "definir") return (clave, fn) => implementaciones.set(clave, fn);
        if (nombre === "llamadasA") return (clave) => llamadas.filter((l) => l.clave === clave);
        if (nombre === "reiniciar") return () => { implementaciones.clear(); llamadas.length = 0; };
        return modelo(nombre);
      },
    }
  );
}

const prisma = crearPrismaFalso();
const rutaPrisma = require.resolve(path.join(__dirname, "../../src/db/prisma"));
require.cache[rutaPrisma] = { id: rutaPrisma, filename: rutaPrisma, loaded: true, exports: prisma };

// El registro de peticiones (morgan) y el envio simulado de WhatsApp solo harian
// ruido en la salida de las pruebas.
const rutaMorgan = require.resolve("morgan");
require.cache[rutaMorgan] = { id: rutaMorgan, filename: rutaMorgan, loaded: true, exports: () => (req, res, next) => next() };
const logOriginal = console.log;
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].startsWith("[whatsapp:SIMULADO]")) return;
  logOriginal(...args);
};

// Siguiente dia habil (lun-vie) a partir de N dias a futuro, a la hora indicada.
function diaHabilFuturo(minDias = 10, hora = 10, minutos = 0) {
  const d = new Date();
  d.setDate(d.getDate() + minDias);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  d.setHours(hora, minutos, 0, 0);
  return d;
}

// Horario laboral de la clinica: lunes a viernes 8-18, sabado 8-12.
function horarioClinica(odontologoId = 1) {
  const filas = [1, 2, 3, 4, 5].map((dia, i) => ({ id: i + 1, odontologoId, diaSemana: dia, horaInicio: "08:00", horaFin: "18:00" }));
  filas.push({ id: 6, odontologoId, diaSemana: 6, horaInicio: "08:00", horaFin: "12:00" });
  return filas;
}

// Define las consultas de horario/bloqueos/citas para un odontologo sin citas.
function agendaVacia(odontologoId = 1) {
  prisma.definir("horarioOdontologo.findMany", async ({ where } = {}) =>
    horarioClinica(odontologoId).filter((h) => !where || where.diaSemana === undefined || h.diaSemana === where.diaSemana)
  );
  prisma.definir("bloqueoHorario.findMany", async () => []);
  prisma.definir("cita.findMany", async () => []);
}

module.exports = { prisma, diaHabilFuturo, horarioClinica, agendaVacia };
