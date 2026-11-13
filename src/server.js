const app = require('./app');

// Bat loi toan cuc: tranh sap server khi co unhandled error
process.on('uncaughtException', (err) => {
  console.error('[FATAL uncaughtException]:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL unhandledRejection]:', reason);
});
const { startPulseCleanerJob } = require('./core/jobs/pulseCleaner');

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`QIWAI Core API listening on port ${PORT}`);
  startPulseCleanerJob();
});
