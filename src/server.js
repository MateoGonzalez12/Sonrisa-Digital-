const env = require("./config/env");
const app = require("./app");
const prisma = require("./db/prisma");
const { iniciarCronRecordatorios } = require("./modules/notificaciones/notificaciones.cron");
const chatbot = require("./modules/chatbot/chatbot.service");

// Prisma abre la conexion en la primera consulta, no al arrancar. Eso hacia que
// el primer paciente del dia pagara ~1.7 s de establecimiento de conexion.
// Conectando al iniciar, ese costo lo absorbe el despliegue y no un usuario.
async function calentarConexion() {
  const inicio = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    await chatbot.precargarCatalogo();
    console.log(`Conexion a la base y catalogo listos en ${Date.now() - inicio} ms`);
  } catch (err) {
    // No se aborta el arranque: la API debe responder aunque la base tarde en
    // estar disponible (el health check reportara el estado real).
    console.error("[db] no se pudo conectar al iniciar:", err.message);
  }
}

app.listen(env.port, () => {
  console.log(`Sonrisa Digital API escuchando en http://localhost:${env.port}`);
  calentarConexion();
  iniciarCronRecordatorios();
});
