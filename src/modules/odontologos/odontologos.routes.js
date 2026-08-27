const { Router } = require("express");
const { requireRol } = require("../auth/auth.middleware");
const controller = require("./odontologos.controller");

const router = Router();

router.get("/", controller.listar);
router.get("/bloqueos", requireRol("admin"), controller.listarBloqueos);
router.post("/bloqueos", requireRol("admin"), controller.crearBloqueo);
router.delete("/bloqueos/:id", requireRol("admin"), controller.eliminarBloqueo);

router.get("/:id", controller.obtener);
router.post("/", requireRol("admin"), controller.crear);
router.put("/:id", requireRol("admin"), controller.actualizar);
router.delete("/:id", requireRol("admin"), controller.eliminar);
router.put("/:id/horarios", requireRol("admin"), controller.establecerHorarios);

module.exports = router;
