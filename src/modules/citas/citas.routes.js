const { Router } = require("express");
const { requireRol } = require("../auth/auth.middleware");
const controller = require("./citas.controller");

const router = Router();

router.post("/", controller.crear);
router.get("/buscar", requireRol("admin"), controller.buscar);
router.get("/lista", requireRol("admin"), controller.listar);
router.get("/agenda-general", requireRol("admin"), controller.agendaGeneral);
router.get("/reportes", requireRol("admin"), controller.reportes);
router.get("/:id", requireRol("admin"), controller.obtener);
router.put("/:id/reprogramar", requireRol("admin"), controller.reprogramar);
router.put("/:id/cancelar", requireRol("admin"), controller.cancelar);
router.put("/:id/confirmar", requireRol("admin"), controller.confirmar);

module.exports = router;
