(function () {
  "use strict";
  const config = window.MYSEN_FIREBASE_CONFIG;
  if (!window.firebase || !config) {
    console.error("Firebase Compat or My-Sen config is missing.");
    window.studioBootstrapError = "Firebase SDK / My-Sen config missing";
    window.mysenAuthReady = Promise.resolve(null);
    return;
  }
  try {
    // Studio has a separate named app instance but uses the SAME My-Sen project.
    // Workspace and Studio each sign in with the same internal Firebase Auth alias; no Cloud Functions/custom tokens are used in the Spark edition.
    const studioApp = firebase.apps.find(app => app.name === "mysenStudio") || firebase.initializeApp(config, "mysenStudio");
    window.mysenStudioApp = studioApp;
    window.mysenAuth = firebase.auth(studioApp);
    window.db = firebase.firestore(studioApp);
    window.mysenDb = window.db;
    window.storage = firebase.storage(studioApp);
    window.mysenStorage = window.storage;
    window.firebase = firebase;
    window.mysenAuthReady = new Promise(resolve => {
      let unsubscribe = null;
      unsubscribe = window.mysenAuth.onAuthStateChanged(user => {
        if (unsubscribe) unsubscribe();
        resolve(user || null);
      }, error => {
        console.warn("My-Sen Auth restore failed", error);
        if (unsubscribe) unsubscribe();
        resolve(null);
      });
    });
  } catch (error) {
    console.error("Unable to initialize the My-Sen Studio Firebase project", error);
    window.studioBootstrapError = error.message || String(error);
    window.mysenAuthReady = Promise.resolve(null);
  }
})();
