const { Router } = require("express");
const { requireRol } = require("../auth/auth.middleware");
const controller = require("./pacientes.controller");

const router = Router();

// Modulo admin: buscar citas/pacientes por nombre o cedula (RF-17) e historial (RF-18)
router.get("/", requireRol("admin"), controller.buscar);
router.get("/lista", requireRol("admin"), controller.listar);
router.get("/:cedula/historial", requireRol("admin"), controller.historial);

module.exports = router;
