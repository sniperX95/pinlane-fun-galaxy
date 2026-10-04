'use strict';
// The interactive gates use the real activity transformer with synthetic data.
// No browser-side copy of placement logic and no production API request.
async function installActivityMoveFixture(page) {
  await page.exposeFunction('__qaActivityMove', ({ current, body }) => {
    try {
      const reservation = require('../lib/reservation-activity-move').buildActivityMove(current, body.activityMove);
      return { ok: true, reservation: { ...reservation, updatedAt: new Date().toISOString() }, activityMove: { ...body.activityMove, unchangedActivities: true } };
    } catch (error) {
      return { ok: false, status: error.statusCode || 422, message: error.message };
    }
  });
}
module.exports = { installActivityMoveFixture };
