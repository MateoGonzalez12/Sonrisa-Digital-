const asyncHandler = require("../../utils/asyncHandler");
const service = require("./admin.service");

const resumen = asyncHandler(async (req, res) => {
  res.json(await service.obtenerResumenDashboard());
});

module.exports = { resumen };
