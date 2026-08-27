const { Router } = require("express");
const { requireRol } = require("../auth/auth.middleware");
const controller = require("./agendaMovil.controller");

const router = Router();

router.use(requireRol("staff"));
router.get("/hoy", controller.citasDelDia);
router.get("/semana", controller.citasDeLaSemana);
router.get("/cita/:id", controller.detalleCita);

module.exports = router;
