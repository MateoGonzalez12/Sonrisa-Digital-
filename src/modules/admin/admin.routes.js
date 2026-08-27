const { Router } = require("express");
const { requireRol } = require("../auth/auth.middleware");
const controller = require("./admin.controller");

const router = Router();

router.get("/resumen", requireRol("admin"), controller.resumen);

module.exports = router;
