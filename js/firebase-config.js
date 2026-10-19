// Nextronics Workspace intentionally uses the original My-Sen Firebase project as its single source of truth.
// workspace-config.js must be loaded before this ES module in workspace.html.
if (!window.MYSEN_FIREBASE_CONFIG) throw new Error('Missing My-Sen Firebase config: js/workspace-config.js must load first.');
export const firebaseConfig = window.MYSEN_FIREBASE_CONFIG;
