const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const prisma = require("../../../db/prisma");
const env = require("../../../config/env");
const { AppError } = require("../../../middlewares/errorHandler");

// Autenticacion biometrica (Face ID / Touch ID) para el staff - RF-26.
//
// Como funciona: el iPhone guarda una clave privada protegida por la cara o la
// huella y nunca la entrega a nadie. El servidor guarda solo la clave publica y
// verifica firmas. Por eso, a diferencia del PIN, aqui no hay ningun secreto
// que se pueda robar desde la base de datos.
//
// La credencial queda atada al dominio (rpId): una registrada en localhost no
// sirve en produccion. Al publicar hay que fijar WEBAUTHN_RP_ID y no cambiarlo.

// Los retos (challenge) son de un solo uso y viven segundos. Se guardan en
// memoria porque persistirlos en la base no aporta: si el servidor se reinicia
// en mitad del registro, el usuario simplemente vuelve a intentarlo.
const retos = new Map();
const VIGENCIA_RETO_MS = 2 * 60 * 1000;

function guardarReto(clave, challenge) {
  retos.set(clave, { challenge, expira: Date.now() + VIGENCIA_RETO_MS });
}

function tomarReto(clave) {
  const guardado = retos.get(clave);
  retos.delete(clave); // un reto solo se puede usar una vez
  if (!guardado || guardado.expira < Date.now()) return null;
  return guardado.challenge;
}

// Limpieza periodica para que el Map no crezca indefinidamente.
setInterval(() => {
  const ahora = Date.now();
  for (const [clave, valor] of retos) {
    if (valor.expira < ahora) retos.delete(clave);
  }
}, 5 * 60 * 1000).unref();

function aBase64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

/* ---------------- Registro de la credencial ---------------- */

async function opcionesDeRegistro(odontologoId) {
  const staff = await prisma.odontologo.findUnique({
    where: { id: odontologoId },
    include: { credenciales: true },
  });
  if (!staff) throw new AppError("Personal no encontrado", 404);

  const opciones = await generateRegistrationOptions({
    rpName: env.webauthn.rpName,
    rpID: env.webauthn.rpId,
    userID: Buffer.from(String(staff.id)),
    userName: staff.nombre,
    userDisplayName: staff.nombre,
    attestationType: "none",
    // Evita registrar dos veces el mismo dispositivo.
    excludeCredentials: staff.credenciales.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? c.transports.split(",") : undefined,
    })),
    authenticatorSelection: {
      // "platform" = el sensor del propio equipo (Face ID), no una llave USB.
      authenticatorAttachment: "platform",
      residentKey: "preferred",
      userVerification: "required",
    },
  });

  guardarReto(`reg:${staff.id}`, opciones.challenge);
  return opciones;
}

async function verificarRegistro(odontologoId, respuesta, apodo) {
  const challenge = tomarReto(`reg:${odontologoId}`);
  if (!challenge) throw new AppError("El registro expiro. Intenta de nuevo.", 400);

  let verificacion;
  try {
    verificacion = await verifyRegistrationResponse({
      response: respuesta,
      expectedChallenge: challenge,
      expectedOrigin: env.webauthn.origin,
      expectedRPID: env.webauthn.rpId,
      requireUserVerification: true,
    });
  } catch (err) {
    throw new AppError(`No se pudo registrar la biometria: ${err.message}`, 400);
  }

  if (!verificacion.verified || !verificacion.registrationInfo) {
    throw new AppError("No se pudo verificar la credencial biometrica", 400);
  }

  const { credential } = verificacion.registrationInfo;

  await prisma.credencialWebAuthn.create({
    data: {
      odontologoId,
      credentialId: credential.id,
      publicKey: Buffer.from(credential.publicKey),
      counter: credential.counter || 0,
      transports: credential.transports ? credential.transports.join(",") : null,
      apodo: apodo || "Dispositivo",
    },
  });

  return { ok: true };
}

/* ---------------- Inicio de sesion con biometria ---------------- */

async function opcionesDeLogin(odontologoId) {
  const credenciales = await prisma.credencialWebAuthn.findMany({
    where: { odontologoId },
  });
  if (credenciales.length === 0) {
    throw new AppError("Este usuario aun no tiene biometria configurada. Ingresa con tu PIN.", 404);
  }

  const opciones = await generateAuthenticationOptions({
    rpID: env.webauthn.rpId,
    allowCredentials: credenciales.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? c.transports.split(",") : undefined,
    })),
    userVerification: "required",
  });

  guardarReto(`login:${odontologoId}`, opciones.challenge);
  return opciones;
}

async function verificarLogin(odontologoId, respuesta) {
  const challenge = tomarReto(`login:${odontologoId}`);
  if (!challenge) throw new AppError("El intento expiro. Intenta de nuevo.", 400);

  const credencial = await prisma.credencialWebAuthn.findUnique({
    where: { credentialId: respuesta.id },
  });
  if (!credencial || credencial.odontologoId !== odontologoId) {
    throw new AppError("Credencial biometrica no reconocida", 401);
  }

  let verificacion;
  try {
    verificacion = await verifyAuthenticationResponse({
      response: respuesta,
      expectedChallenge: challenge,
      expectedOrigin: env.webauthn.origin,
      expectedRPID: env.webauthn.rpId,
      requireUserVerification: true,
      credential: {
        id: credencial.credentialId,
        publicKey: new Uint8Array(credencial.publicKey),
        counter: credencial.counter,
        transports: credencial.transports ? credencial.transports.split(",") : undefined,
      },
    });
  } catch (err) {
    throw new AppError(`Fallo la verificacion biometrica: ${err.message}`, 401);
  }

  if (!verificacion.verified) throw new AppError("Verificacion biometrica invalida", 401);

  // El contador antirreplay solo avanza; los passkeys de Apple lo dejan en 0.
  await prisma.credencialWebAuthn.update({
    where: { id: credencial.id },
    data: {
      counter: verificacion.authenticationInfo.newCounter,
      ultimoUso: new Date(),
    },
  });

  return prisma.odontologo.findUnique({ where: { id: odontologoId } });
}

async function listarCredenciales(odontologoId) {
  return prisma.credencialWebAuthn.findMany({
    where: { odontologoId },
    select: { id: true, apodo: true, createdAt: true, ultimoUso: true },
    orderBy: { createdAt: "desc" },
  });
}

async function eliminarCredencial(odontologoId, id) {
  const borradas = await prisma.credencialWebAuthn.deleteMany({
    where: { id: Number(id), odontologoId },
  });
  if (borradas.count === 0) throw new AppError("Credencial no encontrada", 404);
  return { ok: true };
}

module.exports = {
  opcionesDeRegistro,
  verificarRegistro,
  opcionesDeLogin,
  verificarLogin,
  listarCredenciales,
  eliminarCredencial,
  aBase64Url,
};
