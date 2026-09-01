const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const prisma = require("../../../db/prisma");
const env = require("../../../config/env");
const { AppError } = require("../../../middlewares/errorHandler");

// Autenticacion biometrica (Face ID / Touch ID) para el staff.
//
// Como funciona: el iPhone guarda una clave privada protegida por la cara o la
// huella y nunca la entrega a nadie. El servidor guarda solo la clave publica y
// verifica firmas. Por eso, a diferencia del PIN, aqui no hay ningun secreto
// que se pueda robar desde la base de datos.
//
// La credencial queda atada al dominio (rpId): una registrada en localhost no
// sirve en produccion, y al revés tampoco. Si el dominio cambia, cada persona
// tiene que volver a activar Face ID una vez.

// El rpId y el origin DEBEN coincidir con el dominio desde el que el navegador
// hace la peticion. Si no coinciden, el celular rechaza la operacion antes de
// mostrar Face ID (SecurityError: "The relying party ID is not a registrable
// domain suffix of, nor equal to the current domain").
//
// Por eso, cuando WEBAUTHN_RP_ID no esta configurado explicitamente, se derivan
// del propio request en lugar de caer al "localhost" por defecto: asi la
// biometria funciona en el dominio de despliegue sin tener que recordar poner
// dos variables de entorno. Configurar WEBAUTHN_RP_ID sigue teniendo prioridad
// y es lo recomendable en un dominio propio y definitivo.
function contextoDeDominio(req) {
  if (env.webauthn.rpIdExplicito) {
    return { rpId: env.webauthn.rpId, origin: env.webauthn.origin };
  }

  // El navegador envia Origin en toda peticion POST, incluso same-origin.
  const origenPeticion = req && req.get && req.get("origin");
  if (origenPeticion) {
    try {
      return { rpId: new URL(origenPeticion).hostname, origin: origenPeticion };
    } catch (e) {
      /* Origin malformado: se sigue con el Host */
    }
  }

  const host = req && req.get && req.get("host");
  if (host) {
    // Detras del proxy de Render la conexion interna es HTTP; el protocolo real
    // que vio el navegador viene en X-Forwarded-Proto.
    const protocolo = (req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim();
    return { rpId: host.split(":")[0], origin: `${protocolo}://${host}` };
  }

  return { rpId: env.webauthn.rpId, origin: env.webauthn.origin };
}

// Los retos (challenge) son de un solo uso y viven segundos. Se guardan en
// memoria porque persistirlos en la base no aporta: si el servidor se reinicia
// en mitad del registro, el usuario simplemente vuelve a intentarlo.
//
// Junto al reto se guarda el dominio con el que se genero: la verificacion debe
// comprobarse contra ese mismo valor y no contra uno recalculado.
const retos = new Map();
const VIGENCIA_RETO_MS = 2 * 60 * 1000;

function guardarReto(clave, challenge, contexto) {
  retos.set(clave, { challenge, contexto, expira: Date.now() + VIGENCIA_RETO_MS });
}

function tomarReto(clave) {
  const guardado = retos.get(clave);
  retos.delete(clave); // un reto solo se puede usar una vez
  if (!guardado || guardado.expira < Date.now()) return null;
  return guardado;
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

async function opcionesDeRegistro(odontologoId, req) {
  const dominio = contextoDeDominio(req);
  const staff = await prisma.odontologo.findUnique({
    where: { id: odontologoId },
    include: { credenciales: true },
  });
  if (!staff) throw new AppError("Personal no encontrado", 404);

  const opciones = await generateRegistrationOptions({
    rpName: env.webauthn.rpName,
    rpID: dominio.rpId,
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

  guardarReto(`reg:${staff.id}`, opciones.challenge, dominio);
  return opciones;
}

async function verificarRegistro(odontologoId, respuesta, apodo) {
  const reto = tomarReto(`reg:${odontologoId}`);
  if (!reto) throw new AppError("El registro expiro. Intenta de nuevo.", 400);

  let verificacion;
  try {
    verificacion = await verifyRegistrationResponse({
      response: respuesta,
      expectedChallenge: reto.challenge,
      expectedOrigin: reto.contexto.origin,
      expectedRPID: reto.contexto.rpId,
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

async function opcionesDeLogin(odontologoId, req) {
  const dominio = contextoDeDominio(req);
  const credenciales = await prisma.credencialWebAuthn.findMany({
    where: { odontologoId },
  });
  if (credenciales.length === 0) {
    throw new AppError("Este usuario aun no tiene biometria configurada. Ingresa con tu PIN.", 404);
  }

  const opciones = await generateAuthenticationOptions({
    rpID: dominio.rpId,
    allowCredentials: credenciales.map((c) => ({
      id: c.credentialId,
      transports: c.transports ? c.transports.split(",") : undefined,
    })),
    userVerification: "required",
  });

  guardarReto(`login:${odontologoId}`, opciones.challenge, dominio);
  return opciones;
}

async function verificarLogin(odontologoId, respuesta) {
  const reto = tomarReto(`login:${odontologoId}`);
  if (!reto) throw new AppError("El intento expiro. Intenta de nuevo.", 400);

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
      expectedChallenge: reto.challenge,
      expectedOrigin: reto.contexto.origin,
      expectedRPID: reto.contexto.rpId,
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
