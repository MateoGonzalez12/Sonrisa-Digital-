const env = require("./config/env");
const app = require("./app");
const { iniciarCronRecordatorios } = require("./modules/notificaciones/notificaciones.cron");

app.listen(env.port, () => {
  console.log(`Sonrisa Digital API escuchando en http://localhost:${env.port}`);
  iniciarCronRecordatorios();
});
