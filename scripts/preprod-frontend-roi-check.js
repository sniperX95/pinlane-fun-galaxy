// Completes the ROI capture group without repeating the F1-F5 visual rounds.
const gate = require('./preprod-frontend-check');
gate.main({ roiOnly: true, capture: true }).catch(error => {
  console.error(error);
  gate.close();
  process.exitCode = 1;
});
