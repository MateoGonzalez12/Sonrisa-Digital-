require("dotenv").config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    console.warn(`[config] Variable de entorno ${name} no esta definida.`);
  }
  return value;
}

// Origenes permitidos para CORS. En desarrollo se deja abierto; en produccion
// se restringe a los dominios declarados en CORS_ORIGIN (separados por coma)
// para que ningun sitio de terceros pueda consumir la API con el token del
// usuario (RNF-05).
function origenesPermitidos() {
  const crudo = (process.env.CORS_ORIGIN || "").trim();
  if (!crudo) return true; // sin configurar: refleja el origen (comportamiento de desarrollo)
  return crudo.split(",").map((o) => o.trim()).filter(Boolean);
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "clave-dev-insegura-cambiar"),
  corsOrigin: origenesPermitidos(),
  // Activar solo cuando la app este detras de un proxy inverso (Render, Railway, Nginx)
  trustProxy: process.env.TRUST_PROXY === "true",
  whatsappProvider: process.env.WHATSAPP_PROVIDER || "simulado",
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    from: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886",
  },
  adminWhatsappNumber: process.env.ADMIN_WHATSAPP_NUMBER || "",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",

  // Notificaciones push (Web Push / VAPID)
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || "",
    privateKey: process.env.VAPID_PRIVATE_KEY || "",
    subject: process.env.VAPID_SUBJECT || "mailto:contacto@sonrisadigital.com",
  },

  // WebAuthn (Face ID / Touch ID). El rpId debe ser el dominio SIN protocolo ni
  // puerto; el origin si lleva protocolo. Una credencial registrada bajo un
  // rpId no sirve en otro dominio, por eso se configura una sola vez.
  webauthn: {
    rpName: process.env.WEBAUTHN_RP_NAME || "Sonrisa Digital",
    rpId: process.env.WEBAUTHN_RP_ID || "localhost",
    origin: process.env.WEBAUTHN_ORIGIN || "http://localhost:3000",
  },
};
