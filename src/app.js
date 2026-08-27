const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { notFoundHandler, errorHandler } = require("./middlewares/errorHandler");

// Rutas de cada modulo (RNF-04: arquitectura modular - un router por dominio,
// montado de forma independiente; se puede quitar/reemplazar un modulo sin
// tocar los demas).
const authRoutes = require("./modules/auth/auth.routes");
const pacientesRoutes = require("./modules/pacientes/pacientes.routes");
const procedimientosRoutes = require("./modules/procedimientos/procedimientos.routes");
const odontologosRoutes = require("./modules/odontologos/odontologos.routes");
const citasRoutes = require("./modules/citas/citas.routes");
const chatbotRoutes = require("./modules/chatbot/chatbot.routes");
const notificacionesRoutes = require("./modules/notificaciones/notificaciones.routes");
const adminRoutes = require("./modules/admin/admin.routes");
const agendaMovilRoutes = require("./modules/agendaMovil/agendaMovil.routes");

const app = express();

app.use(
  helmet({
    // Permite que la pagina publica cargue el embed de Google Maps (iframe)
    contentSecurityPolicy: false,
  })
);
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // Twilio envia el webhook como form-urlencoded

app.get("/api/salud", (req, res) => res.json({ ok: true, servicio: "sonrisa-digital-api" }));

app.use("/api/auth", authRoutes);
app.use("/api/pacientes", pacientesRoutes);
app.use("/api/procedimientos", procedimientosRoutes);
app.use("/api/odontologos", odontologosRoutes);
app.use("/api/citas", citasRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/notificaciones", notificacionesRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/agenda-movil", agendaMovilRoutes);

// Frontend estatico (landing + panel admin + agenda movil)
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api", notFoundHandler);
app.use(errorHandler);

module.exports = app;
