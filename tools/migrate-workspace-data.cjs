'use strict';
// Optional one-time migration of the old Nextronics workspace collections into My-Sen (stem-battle).
// Dry-run is the default. Pass --apply to write documents that do NOT already exist at the target.
// Requires two Firebase Admin service-account JSON key paths in environment variables.
const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

function serviceAccountFromEnv(keyName) {
  const file = process.env[keyName];
  if (!file) throw new Error(`Set ${keyName} to the path of a Firebase service-account JSON key.`);
  const absolute = path.resolve(file);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

async function main() {
  const sourceKey = serviceAccountFromEnv('NEXTRONIC_SERVICE_ACCOUNT_JSON');
  const targetKey = serviceAccountFromEnv('MYSEN_SERVICE_ACCOUNT_JSON');
  const source = admin.initializeApp({ credential: admin.credential.cert(sourceKey), projectId: 'nextronic-b2847' }, 'nextronics-migration-source');
  const target = admin.initializeApp({ credential: admin.credential.cert(targetKey), projectId: 'stem-battle' }, 'mysen-migration-target');
  const sourceDb = source.firestore();
  const targetDb = target.firestore();
  const apply = process.argv.includes('--apply');
  const collections = ['workspaceTeams', 'workspaceTransactions', 'workspaceMeetingRequests'];
  const report = { mode: apply ? 'apply' : 'dry-run', sourceProject: sourceKey.project_id, targetProject: targetKey.project_id, startedAt: new Date().toISOString(), collections: {} };

  console.log(`Mode: ${report.mode}. Source: ${report.sourceProject}. Target: ${report.targetProject}`);
  for (const collectionName of collections) {
    const sourceSnapshot = await sourceDb.collection(collectionName).get();
    let copied = 0, conflicts = 0, failed = 0;
    for (const sourceDoc of sourceSnapshot.docs) {
      const targetRef = targetDb.collection(collectionName).doc(sourceDoc.id);
      const targetDoc = await targetRef.get();
      if (targetDoc.exists) {
        conflicts++;
        console.warn(`[conflict] ${collectionName}/${sourceDoc.id} already exists in target; preserving the target copy.`);
        continue;
      }
      if (apply) {
        try { await targetRef.create(sourceDoc.data()); copied++; }
        catch (error) {
          if (error.code === 6 || error.code === 'already-exists') conflicts++;
          else { failed++; console.error(`[failed] ${collectionName}/${sourceDoc.id}: ${error.message}`); }
        }
      } else {
        copied++;
        console.log(`[would copy] ${collectionName}/${sourceDoc.id}`);
      }
    }
    report.collections[collectionName] = { sourceCount: sourceSnapshot.size, copiedOrWouldCopy: copied, conflictsSkipped: conflicts, failed };
    console.log(`${collectionName}: source=${sourceSnapshot.size}, ${apply ? 'copied' : 'would copy'}=${copied}, conflicts=${conflicts}, failed=${failed}`);
  }
  report.finishedAt = new Date().toISOString();
  const output = path.resolve('workspace-migration-report.json');
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Report: ${output}`);
  if (!apply) console.log('Dry run only. Review this report and run again with --apply to copy non-conflicting documents. Auth users, workspaceUsers, teamLoginDirectory, and passwords are NOT migrated because Firebase Auth UIDs do not transfer between projects; re-issue logins from the admin workspace after migrating teams.');
  await Promise.all([source.delete(), target.delete()]);
  const hasFailure = Object.values(report.collections).some(x => x.failed > 0);
  if (hasFailure) process.exitCode = 1;
}
main().catch(error => { console.error(error.stack || error.message || error); process.exitCode = 1; });
