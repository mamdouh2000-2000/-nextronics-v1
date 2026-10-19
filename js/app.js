import {
  initializeApp
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";

import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  onAuthStateChanged,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";

import {
  initializeFirestore, // حطيناها هنا في المكان الصح
  doc,
  getDoc,
  setDoc,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";

import {
  firebaseConfig
} from "./firebase-config.js";

/* =========================================================
   FIREBASE
   ========================================================= */
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

// الكود السحري اللي بيعدي من حظر شركات النت
const db = initializeFirestore(app, {
  experimentalForceLongPolling: true
});

auth.languageCode = "ar";


/* =========================================================
   HELPERS
   ========================================================= */

const $ = (selector) => {
  return document.querySelector(selector);
};


const $$ = (selector) => {
  return [...document.querySelectorAll(selector)];
};


/* =========================================================
   DOM
   ========================================================= */

const modal = $("#authModal");

const status = $("#authStatus");

const authMethods = $("#authMethods");

const phoneVerification = $("#phoneVerification");

const otpSection = $("#otpSection");

const authTitle = $("#authTitle");

const authDescription = $("#authDescription");

const emailAuthBtn = $("#emailAuthBtn");

const loginModeBtn = $("#loginModeBtn");

const registerModeBtn = $("#registerModeBtn");

const forgotPasswordBtn = $("#forgotPasswordBtn");

const phoneInput = $("#phoneInput");

const otpInput = $("#otpInput");

const sendCodeBtn = $("#sendCodeBtn");

const verifyCodeBtn = $("#verifyCodeBtn");

const recaptchaContainer = $("#recaptcha-container");


/* =========================================================
   STATE
   ========================================================= */

let authMode = "login";

let selectedRole = "student";

let confirmationResult = null;

let recaptchaVerifier = null;

let currentUser = null;

let currentUserProfile = null;

let pendingTeamUser = null;

let routedUserUid = null;

let isRoutingUser = false;


/* =========================================================
   CONFIG
   ========================================================= */

const ENGINEER_ACCESS_CODE = "";
const ENGINEER_REGISTRATION_ENABLED = false; // Enable only after a private authorization flow is configured.

/*
  ملاحظة أمنية:
  هذا الكود الموجود في Frontend ليس وسيلة حماية حقيقية.
  هو فقط Gate مبدئي للـUX.
  لاحقًا يجب نقل role/engineer authorization
  إلى Firestore Rules أو Custom Claims/Backend.
*/


const NEXTRONIC_CORE_TEAM = {
  // إيميل ممدوح
  "mmdwhrdwan82@gmail.com": {
    name: "Eng. Mamdouh Radwan",
    role: "Founder & Engineering Lead",
    department: "Computer & Embedded Systems",
    image: "assets/team/mamdouh-radwan.jpg"
  },

  // إيميل دكتور سما
  "smha13334@gmail.com": {
    name: "Dr. Sama Mohamed",
    role: "Medical Research Lead",
    department: "Biomedical / Medical Track",
    image: "assets/team/sama.jpg"
  },

  // إيميل دكتور فاطمة (مؤقتاً بإيميل ممدوح التاني لحد ما تعدله)
  "mamdouh2008radwan@gmail.com": {
    name: "Dr. Fatma El-Saidi",
    role: "Core Team Member",
    department: "Management & Operations",
    image: "assets/team/fatma.jpg"
  }
};


/* =========================================================
   TRANSLATIONS
   ========================================================= */

const translations = {

  ar: {

    nav: {

      home: "الرئيسية",

      competitions: "المسابقات",

      academy: "الأكاديمية",

      team: "فريقنا",

      contact: "تواصل معنا"

    },

    auth: {

      login: "تسجيل الدخول",

      eyebrow: "WELCOME TO NEXTRONIC"

    },

    hero: {

      eyebrow:
        "AI • ENGINEERING • COMPETITIONS",

      title:
        "عقلك يبتكر\nونحن نبني",

      text:
        "منصة متكاملة لتحويل أفكارك إلى مشاريع هندسية وتقنية حقيقية بمساعدة الذكاء الاصطناعي وفريق من المهندسين المتخصصين.",

      start:
        "ابدأ مشروعك الآن",

      explore:
        "استكشف المنصة"

    },

    features: {

      eyebrow:
        "WHAT WE DO",

      title:
        "من الفكرة إلى التنفيذ",

      one: {

        title:
          "تحليل ذكي لفكرتك",

        text:
          "نحلل فكرتك ونحوّلها إلى تصور هندسي واضح وخطة قابلة للتنفيذ."

      },

      two: {

        title:
          "تصميم وتنفيذ احترافي",

        text:
          "فريق متخصص يساعدك في الهاردوير والبرمجيات والنمذجة والتجارب."

      },

      three: {

        title:
          "متابعة لحظية",

        text:
          "تابع تطور مشروعك وتعديلات الفريق من مساحة عمل واحدة."

      },

      four: {

        title:
          "مسابقات وتوثيق",

        text:
          "جهّز مشروعك للمسابقات، البحث العلمي، والـPortfolio الاحترافي."

      }

    },

    competitions: {

      eyebrow:
        "GLOBAL CHALLENGES",

      title:
        "نساعدك للوصول إلى أكبر المسابقات"

    },

    stats: {

      projects:
        "مشروع مدعوم",

      students:
        "طالب ومبتكر",

      competitions:
        "مسابقة علمية",

      engineers:
        "مهندس متخصص"

    },

    cta: {

      eyebrow:
        "YOUR NEXT STEP",

      title:
        "جاهز تبدأ رحلتك؟",

      text:
        "سجّل دخولك وابدأ بتحويل فكرتك إلى مشروع حقيقي.",

      button:
        "سجّل دخولك الآن"

    },

    footer:
      "نبني الأفكار معك، لا بدلًا منك."

  },


  en: {

    nav: {

      home:
        "Home",

      competitions:
        "Competitions",

      academy:
        "Academy",

      team:
        "Our Team",

      contact:
        "Contact"

    },

    auth: {

      login:
        "Sign in",

      eyebrow:
        "WELCOME TO NEXTRONIC"

    },

    hero: {

      eyebrow:
        "AI • ENGINEERING • COMPETITIONS",

      title:
        "Your mind innovates.\nWe build.",

      text:
        "An integrated platform that turns your ideas into real engineering and technology projects with AI and specialized engineers.",

      start:
        "Start your project",

      explore:
        "Explore the platform"

    },

    features: {

      eyebrow:
        "WHAT WE DO",

      title:
        "From idea to execution",

      one: {

        title:
          "Smart idea analysis",

        text:
          "We turn your idea into a clear engineering concept and actionable plan."

      },

      two: {

        title:
          "Professional design & build",

        text:
          "Specialists support your hardware, software, modeling, and experiments."

      },

      three: {

        title:
          "Live progress",

        text:
          "Track project progress and team changes from one workspace."

      },

      four: {

        title:
          "Competitions & documentation",

        text:
          "Prepare your project for competitions, research, and a professional portfolio."

      }

    },

    competitions: {

      eyebrow:
        "GLOBAL CHALLENGES",

      title:
        "We help you reach major competitions"

    },

    stats: {

      projects:
        "Supported projects",

      students:
        "Students & innovators",

      competitions:
        "Science competitions",

      engineers:
        "Specialized engineers"

    },

    cta: {

      eyebrow:
        "YOUR NEXT STEP",

      title:
        "Ready to start?",

      text:
        "Sign in and start turning your idea into a real project.",

      button:
        "Sign in now"

    },

    footer:
      "We build ideas with you, not instead of you."

  }

};


/* =========================================================
   LANGUAGE
   ========================================================= */

function applyLanguage(lang) {

  const t =
    translations[lang];

  if (!t) {
    return;
  }

  document.documentElement.lang =
    lang;

  document.documentElement.dir =
    lang === "ar"
      ? "rtl"
      : "ltr";

  $$("[data-i18n]").forEach(
    (element) => {

      const path =
        element.dataset.i18n.split(".");

      let value = t;

      for (const key of path) {

        if (value == null) {
          break;
        }

        value =
          value[key];

      }

      if (typeof value === "string") {

        element.innerHTML =
          value.replace(
            /\n/g,
            "<br>"
          );

      }

    }
  );

  const languageBtn =
    $("#languageBtn");

  if (languageBtn) {

    languageBtn.textContent =
      lang === "ar"
        ? "EN"
        : "ع";

  }

  localStorage.setItem(
    "nextronics-lang",
    lang
  );

}


/* =========================================================
   THEME
   ========================================================= */

function applyTheme(theme) {

  document.body.classList.toggle(
    "light",
    theme === "light"
  );

  const themeBtn =
    $("#themeBtn");

  if (themeBtn) {

    themeBtn.textContent =
      theme === "light"
        ? "☾"
        : "☼";

  }

  localStorage.setItem(
    "nextronics-theme",
    theme
  );

}


/* =========================================================
   MODAL
   ========================================================= */

function openModal() {

  if (!modal) {
    return;
  }

  modal.classList.remove(
    "hidden"
  );

  if (status) {
    status.textContent = "";
  }

}


function closeModal() {

  if (!modal) {
    return;
  }

  modal.classList.add(
    "hidden"
  );

}


/* =========================================================
   STATUS
   ========================================================= */

function setStatus(
  message,
  type = "normal"
) {

  if (!status) {
    return;
  }

  status.textContent =
    message;

  status.classList.remove(
    "status-success",
    "status-error"
  );

  if (type === "success") {

    status.classList.add(
      "status-success"
    );

  }

  if (type === "error") {

    status.classList.add(
      "status-error"
    );

  }

}


/* =========================================================
   ROLE SELECTOR
   ========================================================= */

function setSelectedRole(role) {

  selectedRole =
    role === "engineer"
      ? "engineer"
      : "student";

  $("#studentRoleBtn")
    ?.classList.toggle(
      "active",
      selectedRole === "student"
    );

  $("#engineerRoleBtn")
    ?.classList.toggle(
      "active",
      selectedRole === "engineer"
    );

  const engineerGroup =
    $("#engineerCodeGroup");

  if (engineerGroup) {

    engineerGroup.classList.toggle(
      "hidden",
      selectedRole !== "engineer"
    );

  }

}


/* =========================================================
   AUTH MODE
   ========================================================= */

function setAuthMode(mode) {

  authMode =
    mode;

  loginModeBtn?.classList.toggle(
    "active",
    mode === "login"
  );

  registerModeBtn?.classList.toggle(
    "active",
    mode === "register"
  );

  if (!emailAuthBtn) {
    return;
  }

  emailAuthBtn.textContent =
    mode === "login"
      ? "تسجيل الدخول"
      : "إنشاء الحساب";

  forgotPasswordBtn?.classList.toggle(
    "hidden",
    mode !== "login"
  );

}


/* =========================================================
   EMAIL AUTH
   ========================================================= */

async function emailAuth() {

  const emailElement =
    $("#emailInput");

  const passwordElement =
    $("#passwordInput");

  const engineerCodeElement =
    $("#engineerCodeInput");

  const email =
    emailElement
      ? emailElement.value.trim()
      : "";

  const password =
    passwordElement
      ? passwordElement.value
      : "";

  const engineerCode =
    engineerCodeElement
      ? engineerCodeElement.value.trim()
      : "";


  if (!email) {

    setStatus(
      "اكتب البريد الإلكتروني.",
      "error"
    );

    return;

  }


  if (!password) {

    setStatus(
      "اكتب كلمة المرور.",
      "error"
    );

    return;

  }


  if (
    authMode === "register" &&
    password.length < 6
  ) {

    setStatus(
      "كلمة المرور لازم تكون 6 أحرف على الأقل.",
      "error"
    );

    return;

  }


  if (
    authMode === "register" &&
    selectedRole === "engineer" &&
    (!ENGINEER_REGISTRATION_ENABLED || !ENGINEER_ACCESS_CODE || engineerCode !== ENGINEER_ACCESS_CODE)
  ) {

    setStatus(
      "التسجيل كمهندس متوقف مؤقتًا. اطلب من الإدارة تفعيل صلاحية حسابك.",
      "error"
    );

    return;

  }


  try {

    emailAuthBtn.disabled =
      true;

    setStatus(
      authMode === "login"
        ? "جاري تسجيل الدخول..."
        : "جاري إنشاء الحساب..."
    );


    let result;


    if (authMode === "login") {

      result =
        await signInWithEmailAndPassword(
          auth,
          email,
          password
        );

    } else {

      result =
        await createUserWithEmailAndPassword(
          auth,
          email,
          password
        );

    }


    currentUser =
      result.user;


    /*
      مهم:
      الدور عند التسجيل فقط.
      في الإنتاج الحقيقي يجب التحقق منه
      من Backend / Firestore Rules.
    */

    await ensureUserProfile(
      currentUser,
      selectedRole
    );


    if (!currentUser.phoneNumber) {

      showPhoneVerification(
        currentUser
      );

    } else {

      await routeAuthenticatedUser(
        currentUser
      );

    }

  } catch (error) {

    console.error(
      "Email authentication error:",
      error
    );

    setStatus(
      getFirebaseErrorMessage(error),
      "error"
    );

  } finally {

    emailAuthBtn.disabled =
      false;

  }

}


/* =========================================================
   PASSWORD RESET
   ========================================================= */

async function forgotPassword() {

  const emailElement =
    $("#emailInput");

  const email =
    emailElement
      ? emailElement.value.trim()
      : "";


  if (!email) {

    setStatus(
      "اكتب بريدك الإلكتروني الأول.",
      "error"
    );

    return;

  }


  try {

    await sendPasswordResetEmail(
      auth,
      email
    );

    setStatus(
      "تم إرسال رابط إعادة تعيين كلمة المرور.",
      "success"
    );

  } catch (error) {

    console.error(
      "Password reset error:",
      error
    );

    setStatus(
      getFirebaseErrorMessage(error),
      "error"
    );

  }

}


/* =========================================================
   PHONE AUTH
   ========================================================= */

async function createRecaptcha() {

  if (recaptchaVerifier) {

    return recaptchaVerifier;

  }


  if (!recaptchaContainer) {

    throw new Error(
      "recaptcha-container not found."
    );

  }


  recaptchaVerifier =
    new RecaptchaVerifier(
      auth,
      "recaptcha-container",
      {
        size: "normal",

        callback: () => {

          setStatus(
            "تم التحقق من reCAPTCHA."
          );

        },

        "expired-callback": () => {

          setStatus(
            "انتهت صلاحية reCAPTCHA.",
            "error"
          );

        }

      }
    );


  await recaptchaVerifier.render();


  return recaptchaVerifier;

}


async function sendPhoneCode() {

  const phone =
    phoneInput
      ? phoneInput.value.trim()
      : "";


  if (!phone) {

    setStatus(
      "اكتب رقم الهاتف بصيغة دولية مثل +2010xxxxxxxx.",
      "error"
    );

    return;

  }


  try {

    sendCodeBtn.disabled =
      true;

    setStatus(
      "جاري تجهيز التحقق..."
    );


    const verifier =
      await createRecaptcha();


    setStatus(
      "جاري إرسال SMS..."
    );


    /*
      هنا التصحيح المهم:
      signInWithPhoneNumber
      هو تدفق تسجيل الدخول بالهاتف.
    */

    confirmationResult =
      await signInWithPhoneNumber(
        auth,
        phone,
        verifier
      );


    otpSection?.classList.remove(
      "hidden"
    );


    setStatus(
      "تم إرسال كود التحقق إلى هاتفك.",
      "success"
    );

  } catch (error) {

    console.error(
      "Phone authentication error:",
      error
    );

    setStatus(
      getFirebaseErrorMessage(error),
      "error"
    );

    resetRecaptcha();

  } finally {

    sendCodeBtn.disabled =
      false;

  }

}


async function verifyPhoneCode() {

  const code =
    otpInput
      ? otpInput.value.trim()
      : "";


  if (!confirmationResult) {

    setStatus(
      "أرسل كود التحقق أولاً.",
      "error"
    );

    return;

  }


  if (!/^\d{6}$/.test(code)) {

    setStatus(
      "اكتب كود التحقق المكون من 6 أرقام.",
      "error"
    );

    return;

  }


  try {

    verifyCodeBtn.disabled =
      true;

    setStatus(
      "جاري تأكيد الرقم..."
    );


    const result =
      await confirmationResult.confirm(
        code
      );


    currentUser =
      result.user;


    await ensureUserProfile(
      currentUser,
      selectedRole
    );


    setStatus(
      "تم تأكيد رقم الهاتف بنجاح.",
      "success"
    );


    await routeAuthenticatedUser(
      currentUser
    );

  } catch (error) {

    console.error(
      "OTP verification error:",
      error
    );

    setStatus(
      getFirebaseErrorMessage(error),
      "error"
    );

  } finally {

    verifyCodeBtn.disabled =
      false;

  }

}


/* =========================================================
   RECAPTCHA RESET
   ========================================================= */

function resetRecaptcha() {

  if (recaptchaVerifier) {

    try {

      recaptchaVerifier.clear();

    } catch (error) {

      console.warn(
        "reCAPTCHA clear warning:",
        error
      );

    }

    recaptchaVerifier =
      null;

  }


  if (recaptchaContainer) {

    recaptchaContainer.innerHTML =
      "";

  }

}


/* =========================================================
   USER PROFILE
   ========================================================= */

async function ensureUserProfile(
  user,
  requestedRole = "student"
) {

  if (!user) {
    return null;
  }


  const ref =
    doc(
      db,
      "users",
      user.uid
    );


  const snapshot =
    await getDoc(ref);


  if (snapshot.exists()) {

    currentUserProfile =
      snapshot.data();

    return currentUserProfile;

  }


  const profile = {

    uid:
      user.uid,

    email:
      user.email || "",

    name:
      user.displayName ||
      "NEXTRONIC User",

    role:
      requestedRole === "engineer"
        ? "engineer"
        : "student",

    phone:
      user.phoneNumber || "",

    field:
      "",

    bio:
      "",

    photoURL:
      user.photoURL || "",

    createdAt:
      serverTimestamp(),

    updatedAt:
      serverTimestamp()

  };


  await setDoc(
    ref,
    profile
  );


  currentUserProfile =
    profile;


  return profile;

}


/* =========================================================
   LOAD PROFILE
   ========================================================= */

async function loadCurrentUserProfile() {

  if (!currentUser) {
    return null;
  }


  const ref =
    doc(
      db,
      "users",
      currentUser.uid
    );


  const snapshot =
    await getDoc(ref);


  if (!snapshot.exists()) {

    return ensureUserProfile(
      currentUser,
      "student"
    );

  }


  currentUserProfile =
    snapshot.data();


  return currentUserProfile;

}


/* =========================================================
   ROLE
   ========================================================= */

function getNextronicUserRole(user) {

  if (!user || !user.email) {

    return (
      currentUserProfile?.role ||
      "student"
    );

  }


  const email =
    user.email
      .toLowerCase()
      .trim();


  if (
    NEXTRONIC_CORE_TEAM[email]
  ) {

    return "admin";

  }


  if (
    currentUserProfile?.role ===
    "engineer"
  ) {

    return "engineer";

  }


  return "student";

}


/* =========================================================
   TEAM MEMBER
   ========================================================= */

function getNextronicTeamMember(user) {

  if (!user || !user.email) {
    return null;
  }


  const email =
    user.email
      .toLowerCase()
      .trim();


  return (
    NEXTRONIC_CORE_TEAM[email] ||
    null
  );

}


/* =========================================================
   MAIN ROUTER
   ========================================================= */

async function routeAuthenticatedUser(user) {

  if (!user) {
    return;
  }


  currentUser =
    user;


  if (isRoutingUser) {
    return;
  }


  if (
    routedUserUid === user.uid
  ) {

    return;

  }


  isRoutingUser =
    true;


  try {

    await loadCurrentUserProfile();


    const role =
      getNextronicUserRole(
        user
      );


    console.log(
      "NEXTRONIC ROLE:",
      role
    );


    console.log(
      "AUTHENTICATED USER:",
      user.email
    );


    if (role === "admin") {

      openTeamCodeGate(
        user
      );

      return;

    }


    if (role === "engineer") {

      openEngineerDashboard(
        user
      );

      return;

    }


    openStudentDashboard(
      user
    );

  } catch (error) {

    console.error(
      "Routing error:",
      error
    );

    setStatus(
      "حدث خطأ أثناء فتح مساحة العمل.",
      "error"
    );

  } finally {

    isRoutingUser =
      false;

  }

}


/* =========================================================
   HIDE ALL APP PAGES
   ========================================================= */

function hideAllPrivatePages() {

  $("#student-dashboard")
    ?.classList.add(
      "hidden"
    );

  $("#engineer-dashboard")
    ?.classList.add(
      "hidden"
    );

  $("#core-team-page")
    ?.classList.add(
      "hidden"
    );

  document
    .querySelector("main")
    ?.classList.remove(
      "hidden"
    );

}


/* =========================================================
   STUDENT DASHBOARD
   ========================================================= */

async function openStudentDashboard(user) {

  routedUserUid =
    user.uid;


  hideAllPrivatePages();


  const landing =
    document.querySelector("main");


  const dashboard =
    $("#student-dashboard");


  if (!dashboard) {

    console.error(
      "student-dashboard not found."
    );

    return;

  }


  landing?.classList.add(
    "hidden"
  );


  dashboard.classList.remove(
    "hidden"
  );


  closeModal();


  updateStudentIdentity(
    user
  );


  await loadStudentProjects();

  await loadStudentAiCount();

  await loadStudentProfileForm();

// السطر ده هيجبر الداشبورد تفتح على شاشة الذكاء الاصطناعي كأنها Start Chat
  showStudentView("ai");
  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


/* =========================================================
   STUDENT IDENTITY
   ========================================================= */

function updateStudentIdentity(user) {

  const name =
    currentUserProfile?.name ||
    user.displayName ||
    "NEXTRONIC Student";


  $$("[data-user-name]").forEach(
    element => {
      element.textContent =
        name;
    }
  );


  $$("[data-user-email]").forEach(
    element => {
      element.textContent =
        user.email || "";
    }
  );


  const letter =
    name
      .trim()
      .charAt(0)
      .toUpperCase() ||
    "N";


  $$("[data-user-avatar]").forEach(
    element => {
      element.textContent =
        letter;
    }
  );

}


/* =========================================================
   STUDENT VIEWS
   ========================================================= */

function showStudentView(view) {

  $$("#student-dashboard .dashboard-view")
    .forEach(
      element => {

        element.classList.toggle(
          "active",
          element.id ===
          `student-view-${view}`
        );

      }
    );


  $$("#student-dashboard .dashboard-nav-item")
    .forEach(
      element => {

        element.classList.toggle(
          "active",
          element.dataset.dashboardView ===
          view
        );

      }
    );

}


/* =========================================================
   ENGINEER DASHBOARD
   ========================================================= */

async function openEngineerDashboard(user) {

  routedUserUid =
    user.uid;


  hideAllPrivatePages();


  const dashboard =
    $("#engineer-dashboard");


  if (!dashboard) {

    console.error(
      "engineer-dashboard not found."
    );

    return;

  }


  document
    .querySelector("main")
    ?.classList.add(
      "hidden"
    );


  dashboard.classList.remove(
    "hidden"
  );


  closeModal();


  updateEngineerIdentity(
    user
  );


  await loadEngineerProjects();

  await loadEngineerStudents();

  await loadEngineerTasks();

  await loadEngineerProfileForm();


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


/* =========================================================
   ENGINEER IDENTITY
   ========================================================= */

function updateEngineerIdentity(user) {

  const name =
    currentUserProfile?.name ||
    user.displayName ||
    "NEXTRONIC Engineer";


  $$("[data-engineer-name]")
    .forEach(
      element => {
        element.textContent =
          name;
      }
    );


  $$("[data-engineer-email]")
    .forEach(
      element => {
        element.textContent =
          user.email || "";
      }
    );


  const letter =
    name
      .trim()
      .charAt(0)
      .toUpperCase() ||
    "E";


  $$("[data-engineer-avatar]")
    .forEach(
      element => {
        element.textContent =
          letter;
      }
    );

}


/* =========================================================
   ENGINEER VIEWS
   ========================================================= */

function showEngineerView(view) {

  $$("#engineer-dashboard .dashboard-view")
    .forEach(
      element => {

        element.classList.toggle(
          "active",
          element.id ===
          `engineer-view-${view}`
        );

      }
    );


  $$("#engineer-dashboard .dashboard-nav-item")
    .forEach(
      element => {

        element.classList.toggle(
          "active",
          element.dataset.engineerView ===
          view
        );

      }
    );

}


/* =========================================================
   PROJECTS
   ========================================================= */

async function loadStudentProjects() {

  if (!currentUser) {
    return;
  }


  const list =
    $("#student-project-list");


  const featured =
    $("#student-featured-project");


  try {

    const projectsRef =
      collection(
        db,
        "users",
        currentUser.uid,
        "projects"
      );


    const snapshot =
      await getDocs(
        query(
          projectsRef,
          orderBy(
            "createdAt",
            "desc"
          ),
          limit(30)
        )
      );


    const projects =
      snapshot.docs.map(
        item => ({
          id:
            item.id,

          ...item.data()

        })
      );


    $("#studentProjectCount")
      .textContent =
      projects.length;


    if (!projects.length) {

      return;

    }


    renderStudentProjects(
      list,
      projects
    );


    renderFeaturedProject(
      featured,
      projects[0]
    );


    updateStudentProgress(
      projects[0]
    );

  } catch (error) {

    console.error(
      "Student projects error:",
      error
    );

  }

}


/* =========================================================
   RENDER PROJECTS
   ========================================================= */

function renderStudentProjects(
  container,
  projects
) {

  if (!container) {
    return;
  }


  container.innerHTML =
    projects.map(
      project => {

        const progress =
          Number(
            project.progress || 0
          );


        return `

          <article
            class="project-card glass"
          >

            <div class="project-card-icon">
              ◈
            </div>

            <div>

              <span class="project-status">
                ${escapeHtml(
                  project.status ||
                  "active"
                )}
              </span>

              <h3>
                ${escapeHtml(
                  project.name ||
                  "Untitled Project"
                )}
              </h3>

              <p>
                ${escapeHtml(
                  project.description ||
                  "مشروع NEXTRONIC"
                )}
              </p>

            </div>

            <div class="project-progress">

              <div>
                <span>
                  Progress
                </span>

                <strong>
                  ${progress}%
                </strong>
              </div>

              <div class="progress-bar">
                <span
                  style="width:${progress}%"
                ></span>
              </div>

            </div>

          </article>

        `;

      }
    ).join("");

}


/* =========================================================
   FEATURED PROJECT
   ========================================================= */

function renderFeaturedProject(
  container,
  project
) {

  if (!container || !project) {
    return;
  }


  const progress =
    Number(
      project.progress || 0
    );


  container.innerHTML = `

    <div class="featured-project">

      <div class="featured-project-icon">
        ◈
      </div>

      <div class="featured-project-content">

        <span class="project-status">
          ${escapeHtml(
            project.status ||
            "active"
          )}
        </span>

        <h3>
          ${escapeHtml(
            project.name ||
            "Untitled Project"
          )}
        </h3>

        <p>
          ${escapeHtml(
            project.description ||
            ""
          )}
        </p>

        <div class="progress-bar">
          <span
            style="width:${progress}%"
          ></span>
        </div>

        <small>
          ${progress}% مكتمل
        </small>

      </div>

    </div>

  `;

}


/* =========================================================
   PROGRESS
   ========================================================= */

function updateStudentProgress(
  project
) {

  if (!project) {
    return;
  }


  const progress =
    Number(
      project.progress || 0
    );


  $("#studentProgressValue")
    .textContent =
    `${progress}%`;


  $("#mainProgressCircle")
    .textContent =
    `${progress}%`;


  $("#mainProgressBar")
    .style.width =
    `${progress}%`;


  $("#progressProjectName")
    .textContent =
    project.name ||
    "Current Project";


  const timeline =
    $$("#project-timeline .timeline-item");


  timeline.forEach(
    (item, index) => {

      const threshold =
        index * 20;


      item.classList.toggle(
        "completed",
        progress >=
        threshold
      );

    }
  );

}


/* =========================================================
   AI COUNT
   ========================================================= */

async function loadStudentAiCount() {

  if (!currentUser) {
    return;
  }


  try {

    const ref =
      collection(
        db,
        "users",
        currentUser.uid,
        "aiMessages"
      );


    const snapshot =
      await getDocs(
        query(
          ref,
          limit(100)
        )
      );


    $("#studentAiCount")
      .textContent =
      snapshot.size;

  } catch (error) {

    console.warn(
      "AI count unavailable:",
      error
    );

  }

}


/* =========================================================
   AI CHAT
   ========================================================= */

async function sendAiMessage(
  text
) {

  if (!currentUser) {

    openModal();

    return;

  }


  const cleanText =
    text.trim();


  if (!cleanText) {
    return;
  }


  appendAiMessage(
    "user",
    cleanText
  );


  const input =
    $("#aiChatInput");


  if (input) {
    input.value = "";
  }


  const typingId =
    appendAiMessage(
      "assistant",
      "جاري التفكير..."
    );


  try {

    const token =
      await currentUser.getIdToken();


    /*
      IMPORTANT:
      لا نضع OpenAI API key هنا.
      الطلب يذهب إلى Backend الخاص بك.
    */

    const response =
      await fetch(
        "/api/ai-chat",
        {
          method:
            "POST",

          headers: {

            "Content-Type":
              "application/json",

            "Authorization":
              `Bearer ${token}`

          },

          body:
            JSON.stringify({

              message:
                cleanText,

              userId:
                currentUser.uid,

              projectId:
                "current",

              role:
                getNextronicUserRole(
                  currentUser
                )

            })

        }
      );


    if (!response.ok) {

      throw new Error(
        `AI server returned ${response.status}`
      );

    }


    const data =
      await response.json();


    replaceAiMessage(
      typingId,
      data.reply ||
      "لم يصل رد من AI."
    );


    await saveAiMessage(
      cleanText,
      data.reply ||
      ""
    );


    await loadStudentAiCount();

  } catch (error) {

    console.error(
      "AI error:",
      error
    );


    replaceAiMessage(
      typingId,
      "تعذر الاتصال بالـAI حاليًا. تأكد أن Backend الخاص بالـAI يعمل."
    );

  }

}


/* =========================================================
   AI UI
   ========================================================= */

function appendAiMessage(
  role,
  text
) {

  const container =
    $("#studentAiMessages");


  if (!container) {
    return null;
  }


  const id =
    `ai-msg-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2)}`;


  const wrapper =
    document.createElement(
      "div"
    );


  wrapper.className =
    `ai-message ${role}`;


  wrapper.dataset.messageId =
    id;


  wrapper.innerHTML = `

    <div class="message-avatar">
      ${
        role === "assistant"
          ? "AI"
          : "YOU"
      }
    </div>

    <div class="message-bubble">
      ${escapeHtml(text)}
    </div>

  `;


  container.appendChild(
    wrapper
  );


  container.scrollTop =
    container.scrollHeight;


  return id;

}


function replaceAiMessage(
  id,
  text
) {

  const message =
    document.querySelector(
      `[data-message-id="${id}"]`
    );


  if (!message) {
    return;
  }


  const bubble =
    message.querySelector(
      ".message-bubble"
    );


  if (bubble) {

    bubble.textContent =
      text;

  }

}


async function saveAiMessage(
  userText,
  assistantText
) {

  if (!currentUser) {
    return;
  }


  try {

    const ref =
      collection(
        db,
        "users",
        currentUser.uid,
        "aiMessages"
      );


    await addDoc(
      ref,
      {

        userText,

        assistantText,

        createdAt:
          serverTimestamp()

      }
    );

  } catch (error) {

    console.warn(
      "Could not save AI message:",
      error
    );

  }

}


/* =========================================================
   PROFILE
   ========================================================= */

async function loadStudentProfileForm() {

  await loadCurrentUserProfile();


  if (!currentUserProfile) {
    return;
  }


  $("#profileNameInput").value =
    currentUserProfile.name || "";


  $("#profileEmailInput").value =
    currentUserProfile.email ||
    currentUser?.email ||
    "";


  $("#profileFieldInput").value =
    currentUserProfile.field || "";


  $("#profileBioInput").value =
    currentUserProfile.bio || "";

}


async function saveStudentProfile() {

  if (!currentUser) {
    return;
  }


  const name =
    $("#profileNameInput").value.trim();


  const field =
    $("#profileFieldInput").value.trim();


  const bio =
    $("#profileBioInput").value.trim();


  try {

    await setDoc(
      doc(
        db,
        "users",
        currentUser.uid
      ),
      {

        name,

        field,

        bio,

        updatedAt:
          serverTimestamp()

      },
      {
        merge:
          true
      }
    );


    if (name) {

      await updateProfile(
        currentUser,
        {
          displayName:
            name
        }
      );

    }


    currentUserProfile =
      {
        ...currentUserProfile,
        name,
        field,
        bio
      };


    updateStudentIdentity(
      currentUser
    );


    $("#profileStatus")
      .textContent =
      "تم حفظ الملف الشخصي بنجاح.";

  } catch (error) {

    console.error(
      "Profile save error:",
      error
    );


    $("#profileStatus")
      .textContent =
      "حدث خطأ أثناء حفظ الملف.";

  }

}


/* =========================================================
   ENGINEER DATA
   ========================================================= */

async function loadEngineerProjects() {

  const container =
    $("#engineer-project-list");


  if (!container) {
    return;
  }


  try {

    const projectsSnapshot =
      await getDocs(
        query(
          collection(
            db,
            "projects"
          ),
          where(
            "engineerId",
            "==",
            currentUser.uid
          ),
          limit(50)
        )
      );


    const projects =
      projectsSnapshot.docs.map(
        item => ({
          id:
            item.id,

          ...item.data()

        })
      );


    $("#engineerProjectCount")
      .textContent =
      projects.length;


    $("#engineerActiveCount")
      .textContent =
      projects.filter(
        project =>
          project.status !==
          "completed"
      ).length;


    if (!projects.length) {

      container.innerHTML = `

        <div class="empty-state glass">

          <span>⚙️</span>

          <h3>
            لا توجد مشاريع موكلة
          </h3>

          <p>
            عندما يتم إسناد مشروع لك سيظهر هنا.
          </p>

        </div>

      `;

      return;

    }


    container.innerHTML =
      projects.map(
        project => `

          <article class="project-card glass">

            <div class="project-card-icon">
              ◈
            </div>

            <div>

              <span class="project-status">
                ${escapeHtml(
                  project.status ||
                  "active"
                )}
              </span>

              <h3>
                ${escapeHtml(
                  project.name ||
                  "Project"
                )}
              </h3>

              <p>
                ${escapeHtml(
                  project.description ||
                  ""
                )}
              </p>

            </div>

          </article>

        `
      ).join("");

  } catch (error) {

    console.error(
      "Engineer projects error:",
      error
    );

  }

}


async function loadEngineerStudents() {

  const container =
    $("#engineer-student-list");


  if (!container) {
    return;
  }


  try {

    const snapshot =
      await getDocs(
        query(
          collection(
            db,
            "users"
          ),
          where(
            "role",
            "==",
            "student"
          ),
          limit(50)
        )
      );


    const students =
      snapshot.docs.map(
        item => ({
          id:
            item.id,

          ...item.data()

        })
      );


    $("#engineerStudentCount")
      .textContent =
      students.length;


    if (!students.length) {

      return;

    }


    container.innerHTML =
      students.map(
        student => `

          <article
            class="student-row glass"
          >

            <div class="avatar">
              ${escapeHtml(
                (
                  student.name ||
                  "S"
                )
                  .charAt(0)
                  .toUpperCase()
              )}
            </div>

            <div>

              <strong>
                ${escapeHtml(
                  student.name ||
                  "Student"
                )}
              </strong>

              <small>
                ${escapeHtml(
                  student.email ||
                  ""
                )}
              </small>

            </div>

            <span>
              ${escapeHtml(
                student.field ||
                "Student"
              )}
            </span>

          </article>

        `
      ).join("");

  } catch (error) {

    console.error(
      "Engineer students error:",
      error
    );

  }

}


async function loadEngineerTasks() {

  const container =
    $("#engineer-task-list");


  if (!container) {
    return;
  }


  try {

    const snapshot =
      await getDocs(
        query(
          collection(
            db,
            "tasks"
          ),
          where(
            "engineerId",
            "==",
            currentUser.uid
          ),
          limit(50)
        )
      );


    const tasks =
      snapshot.docs.map(
        item => ({
          id:
            item.id,

          ...item.data()

        })
      );


    $("#engineerTaskCount")
      .textContent =
      tasks.length;


    if (!tasks.length) {

      return;

    }


    container.innerHTML =
      tasks.map(
        task => `

          <article
            class="task-row glass"
          >

            <div>

              <span class="eyebrow">
                TASK
              </span>

              <h3>
                ${escapeHtml(
                  task.title ||
                  "Task"
                )}
              </h3>

              <p>
                ${escapeHtml(
                  task.description ||
                  ""
                )}
              </p>

            </div>

            <strong>
              ${escapeHtml(
                task.status ||
                "pending"
              )}
            </strong>

          </article>

        `
      ).join("");

  } catch (error) {

    console.error(
      "Engineer tasks error:",
      error
    );

  }

}


/* =========================================================
   ENGINEER PROFILE
   ========================================================= */

async function loadEngineerProfileForm() {

  await loadCurrentUserProfile();


  if (!currentUserProfile) {
    return;
  }


  $("#engineerProfileNameInput").value =
    currentUserProfile.name || "";


  $("#engineerProfileEmailInput").value =
    currentUserProfile.email ||
    currentUser?.email ||
    "";


  $("#engineerProfileFieldInput").value =
    currentUserProfile.field || "";


  $("#engineerProfileBioInput").value =
    currentUserProfile.bio || "";

}


async function saveEngineerProfile() {

  if (!currentUser) {
    return;
  }


  const name =
    $("#engineerProfileNameInput")
      .value
      .trim();


  const field =
    $("#engineerProfileFieldInput")
      .value
      .trim();


  const bio =
    $("#engineerProfileBioInput")
      .value
      .trim();


  try {

    await setDoc(
      doc(
        db,
        "users",
        currentUser.uid
      ),
      {

        name,

        field,

        bio,

        role:
          "engineer",

        updatedAt:
          serverTimestamp()

      },
      {
        merge:
          true
      }
    );


    await updateProfile(
      currentUser,
      {
        displayName:
          name
      }
    );


    currentUserProfile =
      {
        ...currentUserProfile,
        name,
        field,
        bio,
        role:
          "engineer"
      };


    updateEngineerIdentity(
      currentUser
    );


    $("#engineerProfileStatus")
      .textContent =
      "تم حفظ الملف الشخصي.";

  } catch (error) {

    console.error(
      "Engineer profile error:",
      error
    );


    $("#engineerProfileStatus")
      .textContent =
      "حدث خطأ أثناء الحفظ.";

  }

}


/* =========================================================
   CORE TEAM
   ========================================================= */

function openTeamCodeGate(user) {

  pendingTeamUser =
    user;


  const teamModal =
    $("#team-code-modal");


  const input =
    $("#team-code-input");


  const error =
    $("#team-code-error");


  if (!teamModal) {

    console.error(
      "team-code-modal was not found."
    );

    return;

  }


  teamModal.classList.remove(
    "hidden"
  );


  if (input) {

    input.value =
      "";

    setTimeout(
      () => input.focus(),
      100
    );

  }


  if (error) {
    error.textContent =
      "";
  }

}


function closeTeamCodeGate() {

  $("#team-code-modal")
    ?.classList.add(
      "hidden"
    );


  pendingTeamUser =
    null;

}


function verifyTeamCode() {

  const input =
    $("#team-code-input");


  const error =
    $("#team-code-error");


  if (!input) {
    return;
  }


  const enteredCode =
    input.value.trim();


  if (
    enteredCode !==
    NEXTRONIC_TEAM_CODE
  ) {

    if (error) {

      error.textContent =
        "رمز الفريق غير صحيح.";

    }


    input.value =
      "";

    input.focus();

    return;

  }


  const user =
    pendingTeamUser;


  if (!user) {

    error.textContent =
      "انتهت جلسة الدخول.";

    return;

  }


  routedUserUid =
    user.uid;


  closeTeamCodeGate();


  openCoreTeamWelcome(
    user
  );

}


function openCoreTeamWelcome(user) {

  hideAllPrivatePages();


  const landingPage =
    document.querySelector(
      "main"
    );


  const corePage =
    $("#core-team-page");


  const memberContainer =
    $("#core-team-member");


  if (!corePage) {

    console.error(
      "core-team-page was not found."
    );

    return;

  }


  landingPage?.classList.add(
    "hidden"
  );


  corePage.classList.remove(
    "hidden"
  );


  const member =
    getNextronicTeamMember(
      user
    );


  if (
    memberContainer &&
    member
  ) {

    memberContainer.innerHTML = `

      <img
        src="${member.image}"
        alt="${escapeHtml(
          member.name
        )}"
        class="core-member-image"
      >

      <div class="core-member-info">

        <span class="eyebrow">
          NEXTRONIC CORE TEAM
        </span>

        <h2>
          ${escapeHtml(
            member.name
          )}
        </h2>

        <h3>
          ${escapeHtml(
            member.role
          )}
        </h3>

        <p>
          ${escapeHtml(
            member.department
          )}
        </p>

      </div>

    `;

  }


  window.scrollTo({
    top: 0,
    behavior: "smooth"
  });

}


/* =========================================================
   LOGOUT
   ========================================================= */

async function logoutNextronicUser() {

  try {

    await signOut(
      auth
    );


    currentUser =
      null;

    currentUserProfile =
      null;

    pendingTeamUser =
      null;

    routedUserUid =
      null;

    isRoutingUser =
      false;


    closeTeamCodeGate();


    hideAllPrivatePages();


    resetAuthUI();


    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });

  } catch (error) {

    console.error(
      "Logout error:",
      error
    );

  }

}


/* =========================================================
   RESET AUTH UI
   ========================================================= */

function resetAuthUI() {

  authMethods?.classList.remove(
    "hidden"
  );

  phoneVerification?.classList.add(
    "hidden"
  );

  otpSection?.classList.add(
    "hidden"
  );


  confirmationResult =
    null;


  $("#emailInput").value =
    "";

  $("#passwordInput").value =
    "";

  $("#phoneInput").value =
    "";

  $("#otpInput").value =
    "";

  $("#engineerCodeInput").value =
    "";


  authTitle.textContent =
    "ابدأ رحلتك";


  authDescription.textContent =
    "أنشئ حسابك أو سجّل الدخول للوصول إلى المنصة.";


  setSelectedRole(
    "student"
  );


  setAuthMode(
    "login"
  );


  resetRecaptcha();

}


/* =========================================================
   ERROR MESSAGES
   ========================================================= */

function getFirebaseErrorMessage(error) {

  const code =
    error?.code || "";


  const messages = {

    "auth/invalid-email":
      "البريد الإلكتروني غير صحيح.",

    "auth/user-not-found":
      "لا يوجد حساب بهذا البريد الإلكتروني.",

    "auth/wrong-password":
      "كلمة المرور غير صحيحة.",

    "auth/invalid-credential":
      "البريد الإلكتروني أو كلمة المرور غير صحيحة.",

    "auth/email-already-in-use":
      "هذا البريد الإلكتروني مستخدم بالفعل.",

    "auth/weak-password":
      "كلمة المرور ضعيفة.",

    "auth/popup-closed-by-user":
      "تم إغلاق نافذة تسجيل الدخول.",

    "auth/popup-blocked":
      "المتصفح منع نافذة تسجيل الدخول.",

    "auth/invalid-phone-number":
      "رقم الهاتف غير صحيح. استخدم +20xxxxxxxxxx.",

    "auth/too-many-requests":
      "طلبات كثيرة. حاول لاحقًا.",

    "auth/quota-exceeded":
      "تم تجاوز حد SMS.",

    "auth/captcha-check-failed":
      "فشل reCAPTCHA.",

    "auth/code-expired":
      "كود التحقق انتهت صلاحيته.",

    "auth/invalid-verification-code":
      "كود التحقق غير صحيح.",

    "auth/network-request-failed":
      "حدثت مشكلة في الاتصال.",

    "auth/operation-not-allowed":
      "طريقة تسجيل الدخول غير مفعلة في Firebase.",

    "auth/unauthorized-domain":
      "الدومين غير مضاف إلى Authorized Domains.",

    "auth/user-disabled":
      "هذا الحساب معطل."

  };


  return (
    messages[code] ||
    error?.message ||
    "حدث خطأ غير متوقع."
  );

}


/* =========================================================
   ESCAPE HTML
   ========================================================= */

function escapeHtml(value) {

  return String(
    value ?? ""
  )
    .replace(
      /&/g,
      "&amp;"
    )
    .replace(
      /</g,
      "&lt;"
    )
    .replace(
      />/g,
      "&gt;"
    )
    .replace(
      /"/g,
      "&quot;"
    )
    .replace(
      /'/g,
      "&#039;"
    );

}


/* =========================================================
   EVENTS
   ========================================================= */

$("#loginBtn")
  ?.addEventListener(
    "click",
    () => { window.location.href = "workspace.html"; }
  );


$("#startBtn")
  ?.addEventListener(
    "click",
    () => { window.location.href = "workspace.html"; }
  );


$("#ctaLoginBtn")
  ?.addEventListener(
    "click",
    () => { window.location.href = "workspace.html"; }
  );


$("#publicAiBtn")
  ?.addEventListener(
    "click",
    () => {

      window.location.href = "workspace.html";
      return;


      openStudentDashboard(
        currentUser
      );


      setTimeout(
        () =>
          showStudentView(
            "ai"
          ),
        50
      );

    }
  );


$("#modalClose")
  ?.addEventListener(
    "click",
    closeModal
  );


$("#modalBackdrop")
  ?.addEventListener(
    "click",
    closeModal
  );


emailAuthBtn
  ?.addEventListener(
    "click",
    emailAuth
  );


loginModeBtn
  ?.addEventListener(
    "click",
    () =>
      setAuthMode(
        "login"
      )
  );


registerModeBtn
  ?.addEventListener(
    "click",
    () =>
      setAuthMode(
        "register"
      )
  );


forgotPasswordBtn
  ?.addEventListener(
    "click",
    forgotPassword
  );


sendCodeBtn
  ?.addEventListener(
    "click",
    sendPhoneCode
  );


verifyCodeBtn
  ?.addEventListener(
    "click",
    verifyPhoneCode
  );


$("#studentRoleBtn")
  ?.addEventListener(
    "click",
    () =>
      setSelectedRole(
        "student"
      )
  );


$("#engineerRoleBtn")
  ?.addEventListener(
    "click",
    () =>
      setSelectedRole(
        "engineer"
      )
  );


/* =========================================================
   STUDENT DASHBOARD EVENTS
   ========================================================= */

$$("[data-dashboard-view]")
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          showStudentView(
            button.dataset.dashboardView
          );

        }
      );

    }
  );


$$("[data-dashboard-view-trigger]")
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          showStudentView(
            button.dataset.dashboardViewTrigger
          );

        }
      );

    }
  );


/* =========================================================
   ENGINEER DASHBOARD EVENTS
   ========================================================= */

$$("[data-engineer-view]")
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          showEngineerView(
            button.dataset.engineerView
          );

        }
      );

    }
  );


/* =========================================================
   AI FORM
   ========================================================= */

$("#aiChatForm")
  ?.addEventListener(
    "submit",
    async event => {

      event.preventDefault();


      const input =
        $("#aiChatInput");


      if (!input) {
        return;
      }


      await sendAiMessage(
        input.value
      );

    }
  );


$$("[data-ai-prompt]")
  .forEach(
    button => {

      button.addEventListener(
        "click",
        () => {

          const input =
            $("#aiChatInput");


          if (!input) {
            return;
          }


          input.value =
            button.dataset.aiPrompt;


          input.focus();

        }
      );

    }
  );


/* =========================================================
   PROFILE EVENTS
   ========================================================= */

$("#saveProfileBtn")
  ?.addEventListener(
    "click",
    saveStudentProfile
  );


$("#saveEngineerProfileBtn")
  ?.addEventListener(
    "click",
    saveEngineerProfile
  );


/* =========================================================
   TEAM CODE ENTER
   ========================================================= */

$("#team-code-input")
  ?.addEventListener(
    "keydown",
    event => {

      if (
        event.key ===
        "Enter"
      ) {

        event.preventDefault();

        verifyTeamCode();

      }

    }
  );


/* =========================================================
   THEME
   ========================================================= */

$("#themeBtn")
  ?.addEventListener(
    "click",
    () => {

      const current =
        document.body.classList.contains(
          "light"
        )
          ? "light"
          : "dark";


      applyTheme(
        current === "light"
          ? "dark"
          : "light"
      );

    }
  );


/* =========================================================
   LANGUAGE
   ========================================================= */

$("#languageBtn")
  ?.addEventListener(
    "click",
    () => {

      const current =
        localStorage.getItem(
          "nextronics-lang"
        ) ||
        "ar";


      applyLanguage(
        current === "ar"
          ? "en"
          : "ar"
      );

    }
  );


/* =========================================================
   AUTH STATE
   ========================================================= */

onAuthStateChanged(
  auth,
  async user => {

    // Legacy email/Google/phone sessions are intentionally not routed on the public site.
    // The only supported workspace entry point is workspace.html (Team ID + password).
    if (document.body?.dataset?.authMode === "team-only") return;

    if (!user) {

      currentUser =
        null;

      currentUserProfile =
        null;

      routedUserUid =
        null;

      return;

    }


    currentUser =
      user;


    console.log(
      "Authenticated user:",
      user.uid
    );


    console.log(
      "Authenticated email:",
      user.email
    );


    /*
      إذا لم يكن هناك phoneNumber،
      نعرض التحقق فقط إذا المستخدم داخل auth modal.
    */

    if (!user.phoneNumber) {

      if (
        modal &&
        !modal.classList.contains(
          "hidden"
        )
      ) {

        showPhoneVerification(
          user
        );

      }

      return;

    }


    try {

      await routeAuthenticatedUser(
        user
      );

    } catch (error) {

      console.error(
        "Auth state routing error:",
        error
      );

    }

  }
);


/* =========================================================
   SHOW PHONE VERIFICATION
   ========================================================= */

function showPhoneVerification(user) {

  currentUser =
    user;


  authMethods?.classList.add(
    "hidden"
  );


  phoneVerification?.classList.remove(
    "hidden"
  );


  otpSection?.classList.add(
    "hidden"
  );


  authTitle.textContent =
    "أكد رقم هاتفك";


  authDescription.textContent =
    "أدخل رقم الهاتف لإكمال تفعيل الحساب.";

}


/* =========================================================
   INITIALIZATION
   ========================================================= */

applyLanguage(
  localStorage.getItem(
    "nextronics-lang"
  ) ||
  "ar"
);


applyTheme(
  localStorage.getItem(
    "nextronics-theme"
  ) ||
  "dark"
);


$("#year")
  .textContent =
  new Date()
    .getFullYear();


setAuthMode(
  "login"
);


setSelectedRole(
  "student"
);


/* =========================================================
   GLOBAL FUNCTIONS
   ========================================================= */

window.openModal =
  openModal;

window.closeTeamCodeGate =
  closeTeamCodeGate;

window.verifyTeamCode =
  verifyTeamCode;

window.logoutNextronicUser =
  logoutNextronicUser;

window.openCoreTeamWelcome =
  openCoreTeamWelcome;

window.openStudentDashboard =
  openStudentDashboard;

window.openEngineerDashboard =
  openEngineerDashboard;