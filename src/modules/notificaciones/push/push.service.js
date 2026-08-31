const webpush = require("web-push");
const prisma = require("../../../db/prisma");
const env = require("../../../config/env");

// Notificaciones push al dispositivo del staff (RF-15 / RF-27).
//
// Se diferencia de WhatsApp en el destinatario: WhatsApp avisa al PACIENTE,
// el push avisa al EQUIPO (la Dra. y la auxiliar) en su propio celular, aunque
// tengan el navegador cerrado. En iOS solo funciona si la agenda fue agregada
// a la pantalla de inicio; esa es una restriccion de Apple, no del sistema.

let configurado = false;

function configurar() {
  if (configurado) return true;
  if (!env.vapid.publicKey || !env.vapid.privateKey) {
    console.warn("[push] VAPID sin configurar: las notificaciones no se enviaran.");
    return false;
  }
  webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
  configurado = true;
  return true;
}

async function registrarSuscripcion(odontologoId, suscripcion, userAgent) {
  const { endpoint, keys } = suscripcion || {};
  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    throw new Error("Suscripcion push invalida");
  }

  // El endpoint es unico por dispositivo: si la persona vuelve a activar las
  // notificaciones en el mismo celular se actualiza en vez de duplicar.
  return prisma.suscripcionPush.upsert({
    where: { endpoint },
    update: { odontologoId, p256dh: keys.p256dh, auth: keys.auth, userAgent },
    create: { odontologoId, endpoint, p256dh: keys.p256dh, auth: keys.auth, userAgent },
  });
}

async function eliminarSuscripcion(endpoint) {
  await prisma.suscripcionPush.deleteMany({ where: { endpoint } });
}

async function enviarA(odontologoId, { titulo, cuerpo, url, tag }) {
  if (!configurar()) return { enviadas: 0, eliminadas: 0 };

  const suscripciones = await prisma.suscripcionPush.findMany({ where: { odontologoId } });
  if (suscripciones.length === 0) return { enviadas: 0, eliminadas: 0 };

  const carga = JSON.stringify({ titulo, cuerpo, url, tag });
  let enviadas = 0;
  let eliminadas = 0;

  await Promise.all(
    suscripciones.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          carga
        );
        enviadas += 1;
        await prisma.suscripcionPush.update({
          where: { id: s.id },
          data: { ultimoEnvio: new Date() },
        });
      } catch (err) {
        // 404/410 = el usuario desinstalo el acceso directo o revoco el permiso.
        // Esa suscripcion ya no sirve nunca mas, se limpia de la base.
        if (err.statusCode === 404 || err.statusCode === 410) {
          await prisma.suscripcionPush.delete({ where: { id: s.id } }).catch(() => {});
          eliminadas += 1;
        } else {
          console.error("[push] fallo el envio:", err.statusCode, err.body || err.message);
        }
      }
    })
  );

  return { enviadas, eliminadas };
}

/* --------- Avisos concretos que dispara el modulo de citas --------- */

function formatearHora(fecha) {
  return new Date(fecha).toLocaleString("es-CO", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

async function avisarCitaNueva(cita) {
  return enviarA(cita.odontologoId, {
    titulo: "Nueva cita agendada",
    cuerpo: `${cita.paciente.nombre} - ${cita.procedimiento.nombre}\n${formatearHora(cita.fechaHora)}`,
    url: "/agenda/hoy.html",
    tag: `cita-${cita.id}`,
  });
}

async function avisarCitaCancelada(cita) {
  return enviarA(cita.odontologoId, {
    titulo: "Cita cancelada",
    cuerpo: `${cita.paciente.nombre} cancelo su cita del ${formatearHora(cita.fechaHora)}`,
    url: "/agenda/hoy.html",
    tag: `cita-${cita.id}`,
  });
}

async function avisarCitaReprogramada(cita) {
  return enviarA(cita.odontologoId, {
    titulo: "Cita reprogramada",
    cuerpo: `${cita.paciente.nombre} quedo para el ${formatearHora(cita.fechaHora)}`,
    url: "/agenda/hoy.html",
    tag: `cita-${cita.id}`,
  });
}

// Permite que la API responda con un error claro en vez de decir "enviado"
// cuando en realidad no hay claves VAPID en el servidor.
function estaConfigurado() {
  return Boolean(env.vapid.publicKey && env.vapid.privateKey);
}

module.exports = {
  estaConfigurado,
  registrarSuscripcion,
  eliminarSuscripcion,
  enviarA,
  avisarCitaNueva,
  avisarCitaCancelada,
  avisarCitaReprogramada,
};
