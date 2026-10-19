# NEXTRONIC Workspace — v3.1 Studio & Workspace refresh (Firebase Spark)

This version removes Cloud Functions from the runtime. It keeps the public login form as **Team ID + Password**, connects Workspace + Studio to the original My-Sen Firebase project (`stem-battle`), and uses Firebase Authentication internally with opaque, generated aliases rather than user-facing email addresses.

## v3.1 refresh

- The team directory now reads all `workspaceTeams` docs without `orderBy(createdAt)`, preventing older docs without that field from disappearing.
- All Studio projects are read without a timestamp order filter, sorted automatically by team/project, and searchable/filterable. Firestore records are authoritative for matching IDs; local-only drafts remain visible with a clear unsynced label.
- Project data is grouped into collapsible sections for brief, team, meetings, roadmap, tasks, materials, finance, files, client view and AI notes.
- Legacy Studio projects without a Workspace team document are surfaced as historical team/project records rather than silently omitted. Existing project IDs and source records are not cloned.
- Wallet transactions and meeting requests are loaded without timestamp ordering so older records lacking `date`/`createdAt` are not silently filtered out. Team payment write and team summary update are batched.
- The password-rotation form reports which phase failed and links a historical Studio project to its new Team ID after credentials are issued.

## Important trade-off

Without a trusted server (Cloud Functions require Blaze), the browser cannot securely mint Firebase Custom Tokens or change another user's password directly. This version uses Firebase Email/Password internally and Firestore profile-based Rules. No Google sign-in button or email field is presented to users. The Email/Password provider must be enabled in Firebase Authentication because it is the free-plan-compatible identity mechanism under the hood. The form still asks only for Team ID and Password.

Account provisioning from the admin browser uses a separate named Auth instance, so creating a team's account does not sign the administrator out of the active Workspace/Studio session. Password changes rotate to a fresh opaque Auth email and deactivate the old workspace profile so existing access is denied by the profile-based rules. New Auth accounts use random opaque aliases that are stored in `teamLoginDirectory/{TEAM_ID}`; passwords are never written to Firestore.

## First-time admin setup

Use the password you already chose, or choose a strong new one. Do not send it in chat or place it in public JavaScript.

1. Open Firebase Console and select project `stem-battle` (My-Sen).
2. Authentication → Sign-in method → enable **Email/Password** only. Do not enable Google; there is still no public email field.
3. Authentication → Users → Add user. Email: `admin-nextronic@teams.nextronic.invalid`. Password: the password you want for Team ID `NEXTRONICS`. If Firebase Console rejects the reserved `.invalid` domain, use another unmonitored alias accepted by the console and enter that exact value as `authEmail` in the directory document below. No real email inbox or verification is used.
4. Copy the newly created user's **UID**.
5. Firestore Database: create these documents. Use the actual UID copied in step 4:

   `workspaceUsers/{UID}`
   - `uid` (string): UID
   - `teamId` (string): `NEXTRONICS`
   - `teamName` (string): `NEXTRONIC`
   - `leaderName` (string): `Platform Admin`
   - `role` (string): `admin`
   - `active` (boolean): `true`
   - `sourceUid` (string): same UID
   - `sourceLinked` (boolean): `true`

   `studio_access/{UID}`
   - `role` (string): `admin`
   - `teamId` (string): `NEXTRONICS`
   - `displayName` (string): `NEXTRONIC Admin`
   - `active` (boolean): `true`

   `teamLoginDirectory/NEXTRONICS`
   - `teamId` (string): `NEXTRONICS`
   - `uid` (string): same UID
   - `authEmail` (string): `admin-nextronic@teams.nextronic.invalid` (or the accepted alias you created)
   - `active` (boolean): `true`
   - `version` (number): `1`

6. Insert helper functions and match blocks from `firebase/mysen-workspace-rules.append.txt` inside the existing `match /databases/{database}/documents { ... }` scope. Replace old Nextronics Workspace match blocks from the Functions edition (including `nxAdminClaim` custom-claims checks) but preserve unrelated My-Sen learning/academy blocks. Do not leave broad overlapping rules such as `allow read, write: if true` for these same collections; Firestore combines matching allows.
7. Upload the updated static website to your current hosting. No Functions deployment command is used and no Blaze upgrade is required for this auth flow.
8. Open `workspace.html`; sign in with Team ID `NEXTRONICS` and the password from step 3.

## Team accounts

- From Admin → Teams → Create, specify the Team ID, password, leader, school/university, project idea, and financial details.
- The login directory holds an opaque internal alias and Auth UID, never a password.
- For an old My-Sen project, open its synthesized team record and use “Issue / change team password”. This creates login credentials and links the existing team record; it does not clone the original `studio_projects` document.
- Password rotation creates a new internal Auth identity and marks the former `workspaceUsers`/`studio_access` records inactive. The old Auth identity may remain listed in Firebase Authentication because deleting other users from the client is not permitted, but it will no longer pass the new workspace profile checks and must not be allowed by any broader legacy rules.

## Optional import from the old Nextronics Firebase project

If you also need to copy old Workspace team/finance/request records from `nextronic-b2847`, the optional migration tool is at `tools/migrate-workspace-data.cjs`. It uses service-account JSON key files; never place those keys in the public website. Install root dependencies with `npm.cmd install`, set environment variables `NEXTRONIC_SERVICE_ACCOUNT_JSON` and `MYSEN_SERVICE_ACCOUNT_JSON` to local key-file paths, run dry-run first, review `workspace-migration-report.json`, back up both databases, then run with `--apply` only if the report is correct. The tool copies only `workspaceTeams`, `workspaceTransactions`, and `workspaceMeetingRequests`. It intentionally does not copy Auth users, `workspaceUsers`, or `teamLoginDirectory`, because Firebase Auth identities do not transfer across projects; issue fresh team logins from the admin UI after migration. My-Sen `studio_projects` remain in their original collection.

## Files and checks

- `js/workspace-app.js`: ID/password login, admin provisioning, rotation, Workspace views.
- `js/workspace-bootstrap.js`: My-Sen Studio Auth/Firestore connection.
- `js/firebase-config.js`: public Firebase web config for `stem-battle`.
- `firebase/mysen-workspace-rules.append.txt`: workspace/Studio rules fragment.
- `firebase/stem-battle-firestore-rules-reference.txt`: complete rules reference for the collection paths known to this project; review the legacy/shared collections before publishing.
- `FIREBASE-RULES-AND-DEPLOY-AR.md`: Arabic deployment and compatibility notes.
- `firebase.json` is intentionally empty so the Firebase CLI won't try to deploy Cloud Functions from this free-plan edition.

Check the browser files locally with `npm.cmd run check` (Node.js installed). Authentication and security still require the Console setup above; passing syntax checks does not mean the live Firebase project has been configured.


## v3.2 Team-first Studio
في v3.2 يبدأ Studio بدليل تيمات الإدارة. افتح التيم لعرض بياناته المرتبطة، واستخدم «فصل كتيم مستقل» عند الحاجة لتعيين مشروع قديم إلى Team ID وحساب منفصل. راجع `UPGRADE-CHANGELOG-AR.md` و`UPGRADE-CHECKLIST-AR.md` قبل استعمال الفصل على بيانات فعلية.


## Nextronics Workspace v3.2 — Team-first Studio

الإدارة تبدأ بدليل التيمات. اختيار التيم يفتح استوديوه فقط، وتظهر داخله المشاريع والمواد والمشتريات والاجتماعات الخاصة به. من ملف تيم يضم أكثر من مشروع، يمكن فصل أحد المشاريع إلى Team ID وكلمة مرور مستقلين دون نسخ المستند الأصلي. راجع `UPGRADE-CHANGELOG-AR.md`, `UPGRADE-CHECKLIST-AR.md` و`QA-REPORT-AR.md` قبل تطبيق الفصل على بيانات Firebase الفعلية.
