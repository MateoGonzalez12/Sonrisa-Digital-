require("dotenv").config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    console.warn(`[config] Variable de entorno ${name} no esta definida.`);
  }
  return value;
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: required("JWT_SECRET", "clave-dev-insegura-cambiar"),
  whatsappProvider: process.env.WHATSAPP_PROVIDER || "simulado",
  twilio: {
    accountSid: process.env.TWILIO_ACCOUNT_SID || "",
    authToken: process.env.TWILIO_AUTH_TOKEN || "",
    from: process.env.TWILIO_WHATSAPP_FROM || "whatsapp:+14155238886",
  },
  adminWhatsappNumber: process.env.ADMIN_WHATSAPP_NUMBER || "",
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || "",
};
