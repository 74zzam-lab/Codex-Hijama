'use strict';

/**
 * V2-5.10: Backup V1 (LevelDB Cloud DB) runtime gate.
 * Disabled by default. Set HIJAMA_ALLOW_BACKUP_V1=1 only for support migration.
 */

function isBackupV1RuntimeDisabled() {
  if (process.env.HIJAMA_ALLOW_BACKUP_V1 === '1') return false;
  return true;
}

function denyBackupV1(action) {
  return {
    ok: false,
    error: 'backup_v1_disabled',
    code: 'BACKUP_V1_DISABLED',
    action: action || null,
    message: 'Backup V1 (LevelDB) is disabled. Use Backup V2 for disaster recovery and Cloud V2 for sync.',
  };
}

module.exports = {
  isBackupV1RuntimeDisabled,
  denyBackupV1,
};
