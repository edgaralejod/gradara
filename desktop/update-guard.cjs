// SPDX-License-Identifier: Apache-2.0
// Guards the in-app updater against networks that break differential downloads.
//
// electron-updater first tries to fetch only the changed parts of the new installer, one
// HTTP Range request per part, and counts progress against the planned size. A proxy that
// ignores the Range header answers every request with the whole file, so far more bytes
// arrive than were planned: progress runs past 100% and the download never ends. When that
// happens the shell cancels the download and restarts it as one plain, whole-file download.

const SLACK_BYTES = 1024 * 1024;

/** More bytes arrived than the download plan expected: Range requests are not being honoured. */
function overran(progress) {
  const { total, transferred } = progress || {};
  return (
    Number.isFinite(total) &&
    Number.isFinite(transferred) &&
    total > 0 &&
    transferred > total * 1.1 + SLACK_BYTES
  );
}

/** Progress for display: a whole number of percent, never outside 0 to 100. */
function clampPercent(percent) {
  return Number.isFinite(percent) ? Math.min(100, Math.max(0, percent)) : 0;
}

module.exports = { overran, clampPercent };
