import { initializeApp, getApp } from "https://www.gstatic.com/firebasejs/12.7.0/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signOut, onAuthStateChanged, deleteUser
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, addDoc, collection, getDocs,
  query, where, serverTimestamp, writeBatch, deleteDoc, runTransaction, onSnapshot
} from "https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => [...root.querySelectorAll(sel)];
const app = (() => { try { return getApp(); } catch { return initializeApp(firebaseConfig); } })();
const auth = getAuth(app);
const appDb = getFirestore(app); // The single primary database is My-Sen (stem-battle).
// Account creation uses a dedicated named Auth instance so creating a team never logs the admin out
// of the main Workspace or Studio sessions. Email/Password is an internal Firebase provider only;
// users still enter Team ID + Password in the public UI.
const provisionerApp = (() => { try { return getApp('nextronicAccountProvisioner'); } catch { return initializeApp(firebaseConfig, 'nextronicAccountProvisioner'); } })();
const provisionerAuth = getAuth(provisionerApp);
const sourceDb = () => window.mysenDb; // Compat Studio client points at the same Firebase project/database.
let session = null;
let loginInProgress = false;
let allTeams = [];
let allProjects = [];
let financeRows = [];
let meetingRows = [];
let meetingSlots = [];
let consultationRows = [];
let consultationMessages = [];
let selectedConsultationId = '';
let liveUnsubs = [];
let liveMessagesUnsub = null;
let meetingLoadError = '';
let slotLoadError = '';
let consultationLoadError = '';
let teamFilter = "all";
let projectChart = null, financeChart = null, cashflowChart = null;
let toastTimer = null;
const EGP = new Intl.NumberFormat('en-EG', { style:'currency', currency:'EGP', maximumFractionDigits:2 });
const money = n => EGP.format(Number(n)||0);
const num = n => Number.isFinite(Number(n)) ? Number(n) : 0;
const now = () => new Date();
const today = () => now().toISOString().slice(0,10);
const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const normalizeTeamId = s => String(s||'').trim().toUpperCase();
const canonicalTeamId = value => normalizeTeamId(value).replace(/\s+/g,'-').replace(/[^A-Z0-9_-]/g,'-').replace(/-+/g,'-').replace(/^[-_]+|[-_]+$/g,'').slice(0,32);
const naturalCompare = (a,b) => String(a ?? '').localeCompare(String(b ?? ''), 'en', {numeric:true, sensitivity:'base'});
function projectTeamIdentifier(project) {
  const missing = new Set(['', 'UNKNOWN', 'N/A', 'NA', '-', 'NONE', 'NULL']);
  const resolve = rawValue => {
    const raw=String(rawValue??'').trim();
    if(missing.has(raw.toUpperCase())) return '';
    const exact=allTeams.find(team=>normalizeTeamId(team.teamId)===normalizeTeamId(raw));
    if(exact) return normalizeTeamId(exact.teamId);
    const canonical=canonicalTeamId(raw);
    const alias=allTeams.find(team=>canonicalTeamId(team.teamId)===canonical);
    return alias ? normalizeTeamId(alias.teamId) : canonical;
  };
  const fields = ['teamId','teamID','team_id','workspaceTeamId','ownerTeamId','teamCode'];
  for (const key of fields) {
    const id=resolve(project?.[key]);
    if(id.length>=3) return id;
  }
  const fallbackFields = ['teamNumber','teamNo','team_number','team'];
  for (const key of fallbackFields) {
    const id=resolve(project?.[key]);
    if(id.length>=3) return id;
  }
  const projectToken = canonicalTeamId(String(project?.id || project?.name || 'PROJECT').replace(/[^A-Z0-9_-]/gi,'-')) || 'PROJECT';
  return `LEGACY-${projectToken}`.slice(0,32);
}
const reservedIds = new Set(['ADMIN','NEXTRONICS','NEXTRONIC-ADMIN','NEXTRONIC_ADMIN','CORE','NEXTRONIC-CORE']);
function isAdmin() { return session?.role === 'admin'; }
function makeOpaqueAuthEmail(teamId) {
  const id = normalizeTeamId(teamId).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  const suffix = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('');
  return `team-${id}-${suffix}@teams.nextronic.invalid`;
}
async function createProvisionedAccount(email, password) {
  await signOut(provisionerAuth).catch(() => {});
  return createUserWithEmailAndPassword(provisionerAuth, email, password);
}
async function readLoginDirectory(teamId) {
  const snap = await getDoc(doc(appDb, 'teamLoginDirectory', normalizeTeamId(teamId)));
  if (!snap.exists()) return null;
  const record = snap.data();
  return record.active === true && typeof record.authEmail === 'string' && record.authEmail.includes('@') ? record : null;
}
function statusFromPayment(team) {
  const contract = num(team.contractValue), paid = num(team.paidAmount);
  if (contract > 0 && paid >= contract) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
}
function paymentLabel(s) { return ({paid:'مدفوع بالكامل',partial:'مدفوع جزئيًا',unpaid:'لم يدفع'})[s] || 'لم يدفع'; }
function showToast(message, type='info') {
  const el=$('#workspace-toast'); if(!el) return;
  el.textContent=message; el.classList.add('show'); el.style.borderColor=type==='error'?'rgba(255,143,156,.35)':type==='success'?'rgba(113,237,205,.3)':'';
  clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.classList.remove('show'),4200);
}
function setAuthStatus(message, type='') { const el=$('#workspace-auth-status'); if(!el) return; el.textContent=message||''; el.className=`workspace-status ${type}`.trim(); }
function setBusy(form,busy){const b=$('button[type="submit"]',form);if(b){b.disabled=busy;b.dataset.oldText ||= b.innerHTML;b.innerHTML=busy?'<i class="fa-solid fa-spinner fa-spin"></i> جاري التنفيذ...':b.dataset.oldText;}}
function prepareSourceApp() {
  if (window.studioBootstrapError) console.warn(window.studioBootstrapError);
  if (!window.mysenDb) console.warn('My-Sen Studio Firestore is not available yet.');
}

function initialProject(teamId,profile) {
  const time=new Date().toISOString();
  return {
    id:`team-${normalizeTeamId(teamId).toLowerCase()}-${Date.now()}`,teamId:normalizeTeamId(teamId),teamNumber:normalizeTeamId(teamId),name:profile.projectName||profile.teamName||`مشروع ${teamId}`,
    school:profile.institution||'Unknown',clientName:profile.leaderName||profile.teamName||teamId,teamMembers:profile.members||'',members:String(profile.members||'').split(/[،,;\n]+/).map(x=>x.trim()).filter(Boolean).map((name,i)=>({id:`member-${i}-${Date.now()}`,name,role:i===0?'Team Member':'عضو فريق'})),
    projectType:profile.educationLevel==='university'?'University Project':'School STEM Project',description:profile.projectIdea||'Unknown',problem:'يُحدَّد أثناء مراجعة الفكرة',deliverables:'خطة تنفيذ، نموذج أولي، وتوثيق نهائي',status:'planning',startDate:today(),deadline:'',contractValue:num(profile.contractValue),deliveryMode:'hybrid',teamScope:'يُحدد بعد مراجعة الفكرة',schoolScope:'المشاركة في الاختبار والتوثيق',timeline:[{id:`step-${Date.now()}-1`,title:'مراجعة الفكرة وتحديد النطاق',description:'مراجعة الفكرة والاحتياجات والمخرجات.',owner:'NEXTRONIC',dueDate:'',status:'planned',notes:''},{id:`step-${Date.now()}-2`,title:'تحديد التصميم وخطة المواد',description:'مراجعة التصميم وتحديد القطع المطلوبة.',owner:'NEXTRONIC',dueDate:'',status:'planned',notes:''},{id:`step-${Date.now()}-3`,title:'التنفيذ والاختبار',description:'التجميع والبرمجة والاختبار.',owner:'Team',dueDate:'',status:'planned',notes:''}],tasks:[],materials:[],ledger:num(profile.paidAmount)>0?[{id:`opening-payment-${Date.now()}`,type:'received',amount:num(profile.paidAmount),date:today(),note:'دفعة افتتاحية عند إنشاء التيم',source:'workspace'}]:[],media:[],meetings:[],aiChatHistory:[],createdBy:normalizeTeamId(teamId),createdAt:time,updatedAt:time
  };
}
async function createTeamRecord({teamId, password, profile, fromAdmin=true}) {
  if (!isAdmin() || !fromAdmin) throw new Error('إنشاء التيمات متاح من حساب الإدارة فقط.');
  const id=normalizeTeamId(teamId);
  if (password.length < 8) throw new Error('كلمة المرور يجب أن تكون 8 أحرف على الأقل.');
  const directoryRef = doc(appDb, 'teamLoginDirectory', id);
  const directorySnap = await getDoc(directoryRef);
  if (directorySnap.exists()) throw new Error('Team ID مستخدم بالفعل. افتح ملف التيم لتغيير كلمة مروره.');

  const email = makeOpaqueAuthEmail(id);
  let authCredential = null;
  let recordsCommitted = false;
  try {
    authCredential = await createProvisionedAccount(email, password);
    const targetUid = authCredential.user.uid;
    const teamDoc={
      teamId:id,teamName:String(profile.teamName||id).trim(),leaderName:String(profile.leaderName||'').trim(),members:String(profile.members||'').trim(),
      educationLevel:profile.educationLevel==='university'?'university':'school',institution:String(profile.institution||'').trim(),projectName:String(profile.projectName||'').trim(),projectIdea:String(profile.projectIdea||'').trim(),
      contractValue:num(profile.contractValue),paidAmount:num(profile.paidAmount),currency:'EGP',paymentStatus:'unpaid',createdAt:new Date().toISOString(),createdBy:session?.teamId||'NEXTRONICS',ownerUid:targetUid,requestedSupport:profile.educationLevel==='university'?'University project mentoring':'School project mentoring',sourceLinked:true
    };
    teamDoc.paymentStatus=statusFromPayment(teamDoc);
    const batch=writeBatch(appDb);
    batch.set(doc(appDb,'workspaceUsers',targetUid),{uid:targetUid,teamId:id,teamName:teamDoc.teamName,leaderName:teamDoc.leaderName,role:'team',active:true,sourceUid:targetUid,sourceLinked:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(appDb,'studio_access',targetUid),{role:'team',teamId:id,displayName:teamDoc.teamName,active:true,createdAt:new Date().toISOString()});
    batch.set(doc(appDb,'workspaceTeams',id),teamDoc);
    batch.set(directoryRef,{teamId:id,uid:targetUid,authEmail:email,active:true,version:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    if (num(profile.paidAmount) > 0) batch.set(doc(appDb,'workspaceTransactions',`opening-${id}`), {
      type:'income',teamId:id,amount:num(profile.paidAmount),date:today(),account:'Other',category:'Opening payment',party:teamDoc.teamName,
      reference:'',note:'دفعة افتتاحية عند إنشاء التيم',source:'workspace-ledger',createdBy:session?.teamId||'NEXTRONICS',createdAt:serverTimestamp()
    });
    await batch.commit();
    recordsCommitted = true;

    const project=initialProject(id,teamDoc);
    // Source Studio project is created only for a new Team ID. Existing Studio projects use password rotation below.
    await window.mysenDb.collection('studio_projects').doc(project.id).set(project);
    await publishTeamProjectView(project);
    teamDoc.projectId=project.id;
    await setDoc(doc(appDb,'workspaceTeams',id),teamDoc,{merge:true});
    return {uid:targetUid,team:teamDoc};
  } catch (error) {
    // If account provisioning failed before Workspace records were committed, clean up the orphaned Auth user.
    if (authCredential?.user && !recordsCommitted) {
      const user = provisionerAuth.currentUser;
      if (user && user.uid === authCredential.user.uid) await deleteUser(user).catch(() => {});
    }
    throw error;
  } finally {
    await signOut(provisionerAuth).catch(() => {});
  }
}
async function loginTeam(event) {
  event.preventDefault(); const form=event.currentTarget; const fd=new FormData(form);
  const id=normalizeTeamId(fd.get('teamId')); const password=String(fd.get('password')||'');
  if(!id||!password) return setAuthStatus('اكتب Team ID وكلمة المرور.','error');
  if(!/^[A-Z0-9_-]{3,32}$/.test(id)) return setAuthStatus('صيغة Team ID غير صحيحة.','error');
  setBusy(form,true); loginInProgress=true; setAuthStatus('جاري التحقق من Team ID وكلمة المرور...');
  try {
    // A public read-only login directory maps Team ID to an opaque internal Firebase Auth email.
    // No email field is shown to users and no Google sign-in is used.
    const directory = await readLoginDirectory(id);
    if (!directory) throw Object.assign(new Error('Team ID أو كلمة المرور غير صحيحة.'), { code:'auth/invalid-credential' });
    const credential = await signInWithEmailAndPassword(auth, directory.authEmail, password);
    if (directory.uid && directory.uid !== credential.user.uid) throw Object.assign(new Error('بيانات الدخول غير صحيحة أو تم تغيير كلمة المرور.'), { code:'auth/invalid-credential' });
    if (!window.mysenAuth) throw new Error('تعذر تهيئة اتصال Studio. راجع Firebase configuration في workspace.html.');
    try {
      await window.mysenAuth.signInWithEmailAndPassword(directory.authEmail, password);
    } catch (studioError) {
      await signOut(auth).catch(() => {});
      throw studioError;
    }
    const snap=await getDoc(doc(appDb,'workspaceUsers',credential.user.uid));
    if(!snap.exists()) throw new Error('الحساب اتوثّق لكن ملف الصلاحيات غير موجود في workspaceUsers. راجع إعداد الإدارة وقواعد Firestore.');
    const profile=snap.data();
    if(profile.active !== true || normalizeTeamId(profile.teamId)!==id || !['admin','team'].includes(profile.role)) throw new Error('الحساب غير مفعّل أو Team ID لا يطابق ملف الصلاحيات.');
    session={...profile,uid:credential.user.uid,sourceUid:credential.user.uid,sourceLinked:true};
    await enterWorkspace(session);
  } catch(error) { console.error(error); await signOut(auth).catch(()=>{}); await window.mysenAuth?.signOut().catch(()=>{}); setAuthStatus(authMessage(error),'error'); }
  finally { loginInProgress=false; setBusy(form,false); }
}
function authMessage(error) {
  const code=error?.code||'';
  const map={
    'auth/invalid-credential':'Team ID أو كلمة المرور غير صحيحة.',
    'auth/user-not-found':'Team ID أو كلمة المرور غير صحيحة.',
    'auth/wrong-password':'Team ID أو كلمة المرور غير صحيحة.',
    'auth/invalid-email':'صيغة بيانات الدخول الداخلية غير صحيحة؛ راجع teamLoginDirectory.',
    'auth/email-already-in-use':'تعذر إنشاء حساب بهذا المعرّف الداخلي. حدّث صفحة الإدارة وحاول مرة أخرى.',
    'auth/weak-password':'كلمة المرور ضعيفة؛ استخدم 8 أحرف على الأقل.',
    'auth/operation-not-allowed':'يجب تفعيل Email/Password داخل Firebase Authentication فقط كطريقة داخلية للدخول بالـ Team ID.',
    'permission-denied':'Firebase Firestore رفض العملية. راجع دمج قواعد أمان My-Sen وWorkspace مع القواعد الحالية.',
    'unavailable':'تعذر الاتصال بـ Firebase مؤقتًا. تحقق من الإنترنت وحاول مجددًا.'
  };
  if(map[code]) return map[code];
  if(String(error?.message||'').includes('Missing or insufficient permissions')) return 'Firebase رفض الوصول. راجع قواعد Firestore في stem-battle، ولا تستبدل قواعد My-Sen القديمة عشوائيًا.';
  const details = error?.details?.message || error?.details;
  if (typeof details === 'string' && details) return details;
  return error?.message||'حدث خطأ غير متوقع أثناء العملية.';
}
function toggleWorkspace(isOn) { $('#workspace-auth').classList.toggle('hidden',isOn); $('#workspace-app').classList.toggle('hidden',!isOn); }
async function enterWorkspace(profile) {
  session=profile; toggleWorkspace(true);
  document.body.classList.remove('sidebar-open');
  const display=profile.role==='admin'?'NEXTRONIC Admin':(profile.teamName||profile.teamId||'Team workspace');
  $('#workspace-user-label').textContent=profile.teamId||'Admin'; $('#workspace-role-label').textContent=profile.role==='admin'?'ADMIN CONTROL ROOM':'TEAM WORKSPACE';
  $('#sidebar-name').textContent=display; $('#sidebar-subtitle').textContent=profile.role==='admin'?'إدارة المنصة':`Team ID · ${profile.teamId}`; $('#sidebar-avatar').textContent=(display.trim()[0]||'N').toUpperCase();
  $('#today-label').textContent=new Intl.DateTimeFormat('ar-EG',{dateStyle:'full'}).format(now());
  $$('[data-admin-only]').forEach(el=>el.classList.toggle('hidden',!isAdmin()));
  $('#nav-team-projects').classList.toggle('hidden',isAdmin());
  $('#team-overview-project').classList.toggle('hidden',isAdmin());
  $('#meeting-request-form-wrap').classList.toggle('hidden',isAdmin());
  $('#meeting-admin-slot-panel')?.classList.toggle('hidden',!isAdmin());
  $('#consultation-new-form')?.classList.toggle('hidden',isAdmin());
  $('#meeting-nav-label').textContent=isAdmin()?'طلبات الاجتماعات':'الاجتماعات والحجز';
  $('#overview-title').textContent=isAdmin()?'غرفة التحكم الرئيسية':`أهلًا ${profile.teamName||profile.teamId}`;
  $('#overview-subtitle').textContent=isAdmin()?'تحكّم في التيمات والمشاريع والمشتريات والسيولة من مساحة واحدة.':'تابع المشروع والخطوات والمواد والاجتماعات الخاصة بتيمك.';
  if(!isAdmin()) $('#recent-heading').textContent='آخر تحديثات مشروعك';
  
  await refreshAll();
  setupWorkspaceLiveFeeds();
  showPage(isAdmin()?'overview':'overview');
}
function showPage(page) {
  const allowed=$(`#page-${page}`);
  if(!allowed || (allowed.hasAttribute('data-admin-only')&&!isAdmin())) return;
  $$('.workspace-page').forEach(el=>{el.classList.remove('active');el.classList.add('hidden')});
  allowed.classList.remove('hidden');allowed.classList.add('active');
  $$('.workspace-nav button').forEach(el=>el.classList.toggle('active',el.dataset.page===page));
  document.body.classList.remove('sidebar-open');
  if(page==='teams') renderTeams(); if(page==='finance') renderFinance(); if(page==='meetings') renderMeetings();
  if(page==='studio'&&isAdmin()) {
    $('#studio-connection-chip').innerHTML=session.sourceLinked?'<i class="fa-solid fa-link"></i> My-Sen متصل':'<i class="fa-solid fa-triangle-exclamation"></i> اتصال يحتاج مراجعة';
    window.populateStudioTeamOptions?.(allTeams);
    window.showStudioTeamDirectory?.();
  }
}
function kpi(icon,title,value,sub='',trend='') {return `<article class="workspace-kpi"><div class="kpi-top"><span>${safe(title)}</span><span class="kpi-icon"><i class="${icon}"></i></span></div><strong>${safe(value)}</strong><small>${safe(sub)} ${trend?`<span class="kpi-trend">${safe(trend)}</span>`:''}</small></article>`;}
async function refreshAll() {
  try {
    await loadTeams(); await loadProjects(); await loadFinance();
    try { await loadMeetingRows(); meetingLoadError=''; } catch(error) { meetingLoadError=authMessage(error); console.error('Meeting requests could not be loaded',error); }
    try { await loadMeetingSlots(); slotLoadError=''; } catch(error) { slotLoadError=authMessage(error); console.error('Meeting slots could not be loaded',error); }
    try { await loadConsultations(); consultationLoadError=''; } catch(error) { consultationLoadError=authMessage(error); console.error('Consultations could not be loaded',error); }
    if(isAdmin()) { $('#nav-team-count').textContent=String(allTeams.length); $('#finance-team-select').innerHTML='<option value="">عام / تشغيل المنصة</option>'+allTeams.map(t=>`<option value="${safe(t.teamId)}">${safe(t.teamId)} · ${safe(t.teamName)}</option>`).join(''); window.populateStudioTeamOptions?.(allTeams); await window.initStudioModule?.({...session,displayName:session.teamName||session.teamId}); }
    renderOverview(); renderTeams(); renderFinance(); renderMeetings(); renderTeamProjects(); renderConsultations();
  } catch(error) { console.error(error); showToast('تعذر تحديث بعض البيانات: '+authMessage(error),'error'); }
}
async function loadTeams() {
  if(!isAdmin()) {
    const id=normalizeTeamId(session.teamId);
    const snap=await getDoc(doc(appDb,'workspaceTeams',id));
    allTeams=snap.exists()?[{...snap.data(),teamId:snap.id}]:[];
    window.nextronicTeamsCache=allTeams;
    return;
  }
  // Do not orderBy(createdAt): legacy team records often predate that field, and
  // Firestore silently excludes documents missing an ordered field.
  const snap=await getDocs(collection(appDb,'workspaceTeams'));
  allTeams=snap.docs.map(d=>({...d.data(),teamId:d.id}));
  allTeams.sort((a,b)=>naturalCompare(a.teamId,b.teamId));
  window.nextronicTeamsCache=allTeams;
}
function createTeamProjectView(project) {
  const keep = (value, keys) => Object.fromEntries(keys.filter(key => value && value[key] !== undefined && value[key] !== null).map(key => [key, value[key]]));
  const teamId = normalizeTeamId(project.teamId || '');
  const teamRecord = (allTeams || []).find(team => normalizeTeamId(team.teamId) === teamId) || {};
  const projectReceived = (Array.isArray(project.ledger) ? project.ledger : []).filter(entry => entry && entry.type === 'received').reduce((sum, entry) => sum + Math.max(0, num(entry.amount)), 0);
  const contract = Math.max(0, num(teamRecord.contractValue), num(project.contractValue));
  const received = Math.max(0, num(teamRecord.paidAmount), projectReceived);
  return {
    id: String(project.id || ''), teamId,
    name: String(project.name || 'مشروع التيم'), school: String(project.school || ''), projectType: String(project.projectType || ''),
    description: String(project.description || project.problem || ''), problem: String(project.problem || ''), deliverables: String(project.deliverables || ''),
    status: String(project.status || 'planning'), startDate: String(project.startDate || ''), deadline: String(project.deadline || ''),
    updatedAt: String(project.updatedAt || new Date().toISOString()), createdAt: String(project.createdAt || ''),
    teamMembers: String(project.teamMembers || ''),
    members: (Array.isArray(project.members) ? project.members : []).map(m => keep(m, ['id','name','role'])),
    timeline: (Array.isArray(project.timeline) ? project.timeline : []).map(step => keep(step, ['id','title','description','owner','dueDate','status','clientUpdate','statusLabel'])),
    tasks: (Array.isArray(project.tasks) ? project.tasks : []).filter(task => task && task.clientVisible !== false && task.teamVisible !== false).map(task => keep(task, ['id','title','name','description','status','dueDate','assignedTo','completedAt','priority'])),
    materials: (Array.isArray(project.materials) ? project.materials : []).map(item => keep(item, ['id','name','category','quantity','status','quantityOrdered','quantityPurchased','quantityReceived','remainingToBuy','remainingToReceive','publicPhotoUrl','imageUrl','publicNote','clientUpdate'])),
    meetings: (Array.isArray(project.meetings) ? project.meetings : []).map(meeting => keep(meeting, ['id','title','kind','dateTime','link','status'])),
    media: (Array.isArray(project.media) ? project.media : []).filter(media => media && (media.teamVisible === true || media.publicToTeam === true)).map(media => keep(media, ['id','title','url','kind','addedAt'])),
    finance: { contract, received, due: Math.max(0, contract - received) },
    meetingDate: String(project.meetingDate || ''), meetingLink: String(project.meetingLink || '')
  };
}
async function publishTeamProjectView(project) {
  const db = sourceDb();
  const teamId = normalizeTeamId(project?.teamId || '');
  if (!db || !teamId || !project?.id) return false;
  const snapshot = createTeamProjectView({...project, teamId});
  const ref = db.collection('studio_team_views').doc(teamId).collection('projects').doc(String(project.id));
  const current = await ref.get();
  if (current.exists && current.data()?.updatedAt === snapshot.updatedAt && current.data()?.teamId === teamId) return true;
  // Replace (do not merge) so no stale/private fields can survive in an old projection document.
  await ref.set(snapshot);
  return true;
}
async function removeTeamProjectView(teamId, projectId) {
  const db = sourceDb(); const id = normalizeTeamId(teamId);
  if (!db || !id || !projectId) return false;
  await db.collection('studio_team_views').doc(id).collection('projects').doc(String(projectId)).delete();
  return true;
}
window.publishTeamProjectView = publishTeamProjectView;
window.removeTeamProjectView = removeTeamProjectView;
async function loadProjects() {
  allProjects=[];
  const db=sourceDb();
  if(!db||!session.sourceLinked) return;
  if (isAdmin()) {
    try {
      const snap = await db.collection('studio_projects').get();
      const procurementSnap = await db.collection('studio_procurements').get().catch(error => {
        console.warn('Studio procurement register unavailable for team status projection', error);
        return null;
      });
      const purchaseRows = procurementSnap ? procurementSnap.docs.map(d=>({...d.data(),id:d.id})) : [];
      allProjects = snap.docs.map(d=>{
        const raw={...d.data(),id:d.id};
        return {...raw,teamId:projectTeamIdentifier(raw)};
      }).map(project => ({
        ...project,
        materials:(Array.isArray(project.materials)?project.materials:[]).map(material => {
          const rows = purchaseRows.filter(r => String(r.projectId||'')===String(project.id) && String(r.materialId||'')===String(material.id||''));
          const required = Math.max(0,num(material.quantity));
          let ordered=0,purchased=0,received=0;
          rows.forEach(r=>{ordered+=Math.max(0,num(r.quantityOrdered??r.quantity));purchased+=Math.max(0,num(r.quantityPurchased??(['bought','partial','received'].includes(r.status)?r.quantity:0)));received+=Math.max(0,num(r.quantityReceived??(r.status==='received'?r.quantity:0)));});
          ordered=Math.max(ordered,purchased); received=Math.min(received,purchased);
          let status=String(material.status||'planned');
          if(rows.length){status=required>0&&received>=required?'received':received>0?'partial':purchased>0?'bought':ordered>0?'ordered':'planned';}
          else { if(['ordered','bought','received'].includes(status))ordered=required; if(['bought','received'].includes(status))purchased=required; if(status==='received')received=required; }
          return {...material,status,quantityOrdered:ordered,quantityPurchased:purchased,quantityReceived:received,remainingToBuy:Math.max(0,required-purchased),remainingToReceive:Math.max(0,purchased-received)};
        })
      }));

      // Keep the complete Studio catalogue visible, including historical projects whose
      // Workspace team document was never created or lacks modern fields.
      const knownTeamIds = new Set(allTeams.map(t => canonicalTeamId(t.teamId)));
      const studioGroups = new Map();
      for (const project of allProjects) {
        const id = projectTeamIdentifier(project);
        project.teamId = id;
        if (!studioGroups.has(id)) studioGroups.set(id, []);
        studioGroups.get(id).push(project);
      }
      for (const [id, rows] of studioGroups.entries()) {
        if (knownTeamIds.has(canonicalTeamId(id))) continue;
        const sortedRows=rows.slice().sort((a,b)=>String(b.updatedAt||b.createdAt||'').localeCompare(String(a.updatedAt||a.createdAt||'')));
        const primary = sortedRows.find(p => p.teamMembers || p.clientName || p.school || p.contractValue) || sortedRows[0];
        const contractValue = Math.max(0, ...rows.map(p => num(p.contractValue)));
        const oldLedger = rows.flatMap(p => Array.isArray(p.ledger) ? p.ledger : []).filter(x => x && x.source !== 'workspace' && x.source !== 'workspace-ledger' && ['received','income'].includes(x.type));
        const paidAmount = oldLedger.reduce((sum, x) => sum + Math.max(0, num(x.amount)), 0);
        allTeams.push({
          teamId:id, teamName:String(primary.teamName || primary.clientName || primary.name || id),
          leaderName:String(primary.clientName || primary.leaderName || ''), members:String(primary.teamMembers || ''),
          educationLevel:/university/i.test(String(primary.projectType || ''))?'university':'school',
          institution:String(primary.school || ''), projectName:String(primary.name || ''), projectIdea:String(primary.description || primary.problem || ''),
          contractValue, paidAmount, paymentStatus:contractValue>0&&paidAmount>=contractValue?'paid':paidAmount>0?'partial':'unpaid',
          ownerUid:null, projectId:primary.id, sourceProjectIds:rows.map(p=>p.id), legacyStudio:true, unassignedLegacy:id.startsWith('LEGACY-'), sourceLinked:true,
          createdAt:primary.createdAt || primary.updatedAt || ''
        });
        knownTeamIds.add(canonicalTeamId(id));
      }
      // Stable, numeric-aware ordering: TEAM-2 sorts before TEAM-10.
      allTeams.sort((a,b)=>naturalCompare(a.teamId,b.teamId));
      allProjects.sort((a,b)=>naturalCompare(a.teamId,b.teamId) || naturalCompare(a.teamNumber||a.teamID||'',b.teamNumber||b.teamID||'') || naturalCompare(a.name,b.name));
      window.nextronicTeamsCache=allTeams;

      // Publish only real/derived team ids, not fabricated ids for completely unassigned legacy projects.
      await Promise.all(allProjects.filter(p => p.teamId && !String(p.teamId).startsWith('LEGACY-')).map(p => publishTeamProjectView(p).catch(error => {
        console.warn('Could not publish team-safe Studio view', p.id, error); return false;
      })));
      const health=$('#studio-source-status');
      if(health){health.classList.remove('error');health.textContent=`تم تحميل ${allProjects.length} مشروعًا من Firestore، و${allTeams.length} تيم/ملف مرتبط.`;}
    } catch(error) {
      console.error('Source project load failed',error);
      const health=$('#studio-source-status');
      if(health){health.classList.add('error');health.textContent=`تعذرت قراءة مشاريع Studio من Firestore (${error.code||error.message||'خطأ غير معروف'}). القائمة الكاملة لم تُحمّل؛ راجع studio_access وRules.`;}
      showToast('تعذرت قراءة مشاريع Studio من Firestore. لن نعرض عددًا ناقصًا على أنه القائمة الكاملة. راجع صلاحيات studio_access وقواعد Firestore.','error');
    }
  } else {
    try {
      const teamId = normalizeTeamId(session.teamId);
      const snap = await db.collection('studio_team_views').doc(teamId).collection('projects').get();
      allProjects = snap.docs.map(d=>({...d.data(),id:d.id,teamId:normalizeTeamId(d.data().teamId||teamId)}));
      allProjects.sort((a,b)=>naturalCompare(a.teamId,b.teamId)||naturalCompare(a.name,b.name));
    } catch(error) {
      console.error('Team-safe project view load failed',error);
      showToast('تعذر تحميل مشروع التيم من Firestore. راجع صلاحيات studio_team_views.','error');
    }
  }
}
async function loadFinance() {
  if(!isAdmin()) {financeRows=[];return;}
  // Read the complete ledger and sort in the UI; orderBy/limit can silently hide legacy rows without a date.
  const snap=await getDocs(collection(appDb,'workspaceTransactions'));
  const centralRows=snap.docs.map(d=>({...d.data(),id:d.id,source:'workspace-ledger'}));
  const studioRows=[];
  const db=sourceDb();
  if(db && session.sourceLinked) {
    try {
      const [projectsSnap,purchaseSnap]=await Promise.all([
        db.collection('studio_projects').get(),
        db.collection('studio_procurements').get()
      ]);
      const projects=projectsSnap.docs.map(d=>({...d.data(),id:d.id}));
      const byProject=new Map(projects.map(p=>[p.id,p]));
      projects.forEach(project=>{
        (Array.isArray(project.ledger)?project.ledger:[]).forEach((entry,index)=>{
          // New Nextronics payments are mirrored into Studio with source=workspace; central ledger is canonical.
          if(entry.source==='workspace' || entry.source==='workspace-ledger') return;
          const type=entry.type==='received'?'income':entry.type;
          if(!['income','expense','transfer'].includes(type)) return;
          studioRows.push({
            id:`studio-ledger-${project.id}-${entry.id||index}`,source:'studio-ledger',type,
            date:String(entry.date||entry.createdAt||project.updatedAt||today()).slice(0,10),teamId:normalizeTeamId(project.teamId||''),
            category:String(entry.category|| (type==='income'?'تحصيل تاريخي من Studio':type==='expense'?'مصروف تاريخي من Studio':'تحويل تاريخي من Studio')),
            account:'My-Sen Studio',party:String(entry.party||project.name||''),amount:num(entry.amount),reference:String(entry.reference||''),
            note:String(entry.note||''),projectId:project.id,projectName:String(project.name||'')
          });
        });
      });
      purchaseSnap.docs.forEach(d=>{
        const r=d.data(); const purchased=Math.max(0,num(r.quantityPurchased??(['bought','partial','received'].includes(r.status)?r.quantity:0)));
        const amount=purchased*Math.max(0,num(r.unitCost??r.purchaseUnitPrice));
        if(amount<=0) return;
        const project=byProject.get(String(r.projectId||''));
        studioRows.push({
          id:`studio-purchase-${d.id}`,source:'studio-purchase',type:'purchase',date:String(r.purchaseDate||r.date||r.updatedAt||today()).slice(0,10),
          teamId:normalizeTeamId(project?.teamId||''),category:'شراء مواد موثق',account:'Studio Procurement',party:String(r.supplier||r.materialName||'شراء مواد'),amount,
          reference:String(r.reference||''),note:`${project?.name||r.projectName||'مشروع غير محدد'} · تم شراء ${purchased} من ${num(r.quantityOrdered??r.quantity)}${r.note?` · ${String(r.note)}`:''}`,
          projectId:String(r.projectId||''),projectName:String(project?.name||r.projectName||'')
        });
      });
    } catch(error) { console.warn('Could not read Studio history for consolidated finance view.',error); }
  }
  financeRows=[...centralRows,...studioRows];
}
async function loadMeetingRows() {
  const ref=collection(appDb,'workspaceMeetingRequests');
  const snap=isAdmin()?await getDocs(ref):await getDocs(query(ref,where('teamId','==',normalizeTeamId(session.teamId))));
  meetingRows=snap.docs.map(d=>({...d.data(),id:d.id}));
  sortRowsByDate(meetingRows);
  updateMeetingBadge();
}
function sortRowsByDate(rows) {
  const stamp=value=>{if(value?.toDate)return value.toDate().getTime();const parsed=new Date(value||0).getTime();return Number.isFinite(parsed)?parsed:0;};
  rows.sort((a,b)=>stamp(b.createdAt||b.updatedAt||b.dateTime||b.startsAt)-stamp(a.createdAt||a.updatedAt||a.dateTime||a.startsAt));
}
function updateMeetingBadge() {
  const badge=$('#nav-meeting-count'); if(!badge)return;
  const pending=meetingRows.filter(x=>x.status==='pending').length;
  badge.textContent=String(pending);badge.classList.toggle('hidden',pending===0);
}
async function loadMeetingSlots() {
  const ref=collection(appDb,'workspaceMeetingSlots');
  const snap=isAdmin()?await getDocs(ref):await getDocs(query(ref,where('status','==','available')));
  meetingSlots=snap.docs.map(d=>({...d.data(),id:d.id}));
  meetingSlots.sort((a,b)=>`${a.date||''}T${a.startTime||''}`.localeCompare(`${b.date||''}T${b.startTime||''}`));
}
async function loadConsultations() {
  const ref=collection(appDb,'workspaceConsultations');
  const snap=isAdmin()?await getDocs(ref):await getDocs(query(ref,where('teamId','==',normalizeTeamId(session.teamId))));
  consultationRows=snap.docs.map(d=>({...d.data(),id:d.id}));
  consultationRows.sort((a,b)=>dateValue(b.updatedAt||b.createdAt)-dateValue(a.updatedAt||a.createdAt));
  if(!selectedConsultationId||!consultationRows.some(x=>x.id===selectedConsultationId)) selectedConsultationId=consultationRows[0]?.id||'';
  await loadConsultationMessages();
}
function dateValue(value) { if(value?.toDate)return value.toDate().getTime();const n=new Date(value||0).getTime();return Number.isFinite(n)?n:0; }
async function loadConsultationMessages() {
  if(!selectedConsultationId){consultationMessages=[];return;}
  const snap=await getDocs(collection(appDb,'workspaceConsultations',selectedConsultationId,'messages'));
  consultationMessages=snap.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>dateValue(a.createdAt)-dateValue(b.createdAt));
}
function clearWorkspaceLiveFeeds() {
  liveUnsubs.forEach(unsub=>{try{unsub();}catch{}});liveUnsubs=[];
  if(liveMessagesUnsub){try{liveMessagesUnsub();}catch{}liveMessagesUnsub=null;}
}
function setupWorkspaceLiveFeeds() {
  clearWorkspaceLiveFeeds();
  if(!session)return;
  const requestRef=isAdmin()?collection(appDb,'workspaceMeetingRequests'):query(collection(appDb,'workspaceMeetingRequests'),where('teamId','==',normalizeTeamId(session.teamId)));
  liveUnsubs.push(onSnapshot(requestRef,snap=>{meetingRows=snap.docs.map(d=>({...d.data(),id:d.id}));sortRowsByDate(meetingRows);meetingLoadError='';updateMeetingBadge();renderMeetings();},error=>{meetingLoadError=authMessage(error);console.error('Live meeting request feed failed',error);renderMeetings();}));
  const slotsRef=isAdmin()?collection(appDb,'workspaceMeetingSlots'):query(collection(appDb,'workspaceMeetingSlots'),where('status','==','available'));
  liveUnsubs.push(onSnapshot(slotsRef,snap=>{meetingSlots=snap.docs.map(d=>({...d.data(),id:d.id}));meetingSlots.sort((a,b)=>`${a.date||''}T${a.startTime||''}`.localeCompare(`${b.date||''}T${b.startTime||''}`));slotLoadError='';renderMeetings();},error=>{slotLoadError=authMessage(error);console.error('Live available slot feed failed',error);renderMeetings();}));
  const consultationRef=isAdmin()?collection(appDb,'workspaceConsultations'):query(collection(appDb,'workspaceConsultations'),where('teamId','==',normalizeTeamId(session.teamId)));
  liveUnsubs.push(onSnapshot(consultationRef,snap=>{consultationRows=snap.docs.map(d=>({...d.data(),id:d.id}));consultationRows.sort((a,b)=>dateValue(b.updatedAt||b.createdAt)-dateValue(a.updatedAt||a.createdAt));consultationLoadError='';if(!selectedConsultationId||!consultationRows.some(x=>x.id===selectedConsultationId))selectedConsultationId=consultationRows[0]?.id||'';renderConsultations();if(selectedConsultationId)subscribeConsultationMessages(selectedConsultationId);},error=>{consultationLoadError=authMessage(error);console.error('Live consultation feed failed',error);renderConsultations();}));
}
function subscribeConsultationMessages(threadId) {
  if(liveMessagesUnsub){try{liveMessagesUnsub();}catch{}liveMessagesUnsub=null;}
  if(!threadId)return;
  liveMessagesUnsub=onSnapshot(collection(appDb,'workspaceConsultations',threadId,'messages'),snap=>{if(selectedConsultationId!==threadId)return;consultationMessages=snap.docs.map(d=>({...d.data(),id:d.id})).sort((a,b)=>dateValue(a.createdAt)-dateValue(b.createdAt));renderConsultationDetail();},error=>{console.error('Consultation messages could not be loaded',error);$('#consultation-thread-detail').innerHTML=`<div class="empty-state"><strong>تعذر تحميل الرسائل</strong><p>${safe(authMessage(error))}</p></div>`;});
}
function teamProjectRows(team) {
  const id=normalizeTeamId(team?.teamId||'');
  return allProjects.filter(p=>{
    const explicit=normalizeTeamId(p.teamId||p.teamID||p.team_id||p.workspaceTeamId||p.ownerTeamId||p.teamCode||'');
    if(explicit) return canonicalTeamId(explicit)===canonicalTeamId(id);
    const teamNumber=normalizeTeamId(p.teamNumber||p.teamNo||p.team_number||p.team||'');
    const numberMatchesRealTeam=teamNumber && allTeams.some(item=>canonicalTeamId(item.teamId)===canonicalTeamId(teamNumber));
    if(numberMatchesRealTeam) return canonicalTeamId(teamNumber)===canonicalTeamId(id);
    return (team?.projectId && p.id===team.projectId) || (Array.isArray(team?.sourceProjectIds) && team.sourceProjectIds.includes(p.id));
  });
}
function projectFinancials(team) {
  const projects=teamProjectRows(team); let contract=num(team.contractValue), received=num(team.paidAmount), expenses=0, materialsCost=0;
  for(const p of projects) {
    contract=Math.max(contract,num(p.contractValue));
    const ledger=Array.isArray(p.ledger)?p.ledger:[];
    const projectReceived=ledger.filter(x=>x.type==='received').reduce((s,x)=>s+num(x.amount),0);
    received=Math.max(received,projectReceived);
    expenses+=ledger.filter(x=>x.type==='expense').reduce((s,x)=>s+num(x.amount),0);
    materialsCost+=(p.materials||[]).reduce((s,m)=>s+num(m.quantity)*num(m.unitPrice),0);
  }
  return {projects,contract,received,due:Math.max(0,contract-received),expenses,materialsCost};
}
function renderOverview() {
  const owned= isAdmin()?allProjects:allProjects.filter(p=>normalizeTeamId(p.teamId)===normalizeTeamId(session.teamId));
  const totalContract=allTeams.reduce((s,t)=>s+num(t.contractValue),0);
  const paid=allTeams.reduce((s,t)=>s+num(t.paidAmount),0);
  const due=allTeams.reduce((s,t)=>s+Math.max(0,num(t.contractValue)-num(t.paidAmount)),0);
  const expense=financeRows.filter(x=>x.type==='expense').reduce((s,x)=>s+num(x.amount),0);
  const income=financeRows.filter(x=>x.type==='income').reduce((s,x)=>s+num(x.amount),0);
  $('#overview-kpis').innerHTML=isAdmin()?[
    kpi('fa-solid fa-people-group','إجمالي التيمات',allTeams.length,'مدارس وجامعات'),kpi('fa-solid fa-diagram-project','المشاريع المسجلة',allProjects.length,'من قاعدة My-Sen'),kpi('fa-solid fa-wallet','إجمالي التحصيل المسجل',money(income),`من إجمالي تعاقدات التيمات ${money(totalContract)}`),kpi('fa-solid fa-hourglass-half','المتبقي للتحصيل',money(due),`${allTeams.filter(t=>statusFromPayment(t)!=='paid').length} تيم عليهم مستحقات`)
  ].join(''):[kpi('fa-solid fa-diagram-project','مشاريع التيم',owned.length,'مشاريع مرتبطة بمعرّفك'),kpi('fa-solid fa-list-check','خطوات مكتملة',owned.reduce((s,p)=>s+(p.timeline||[]).filter(x=>x.status==='done').length,0),'من خارطة التنفيذ'),kpi('fa-solid fa-cubes','بنود المواد',owned.reduce((s,p)=>s+(p.materials||[]).length,0),'المطلوب تنفيذه'),kpi('fa-solid fa-calendar-check','طلبات الاجتماع',meetingRows.length,'المواعيد والطلبات الخاصة بتيمك')].join('');
  if(isAdmin()) {
    const projectBuckets=['planning','active','review','delivered','paused']; const labels=['تخطيط','تنفيذ','مراجعة','تسليم','متوقف']; const colors=['#a4b4cc','#71edcd','#a69aff','#6bdba6','#ff9ba8'];
    projectChart?.destroy(); const c=$('#overview-project-chart'); if(c&&window.Chart) projectChart=new Chart(c,{type:'bar',data:{labels,datasets:[{label:'مشاريع',data:projectBuckets.map(k=>allProjects.filter(p=>(p.status||'planning')===k).length),backgroundColor:colors,borderRadius:7}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{color:'#8ea1bb'},grid:{display:false}},y:{beginAtZero:true,ticks:{color:'#8ea1bb',precision:0},grid:{color:'rgba(142,161,187,.1)'}}}}});
    financeChart?.destroy(); const fc=$('#overview-finance-chart'); if(fc&&window.Chart) financeChart=new Chart(fc,{type:'doughnut',data:{labels:['تم تحصيله','متبقي','مصروفات تشغيل'],datasets:[{data:[income,due,expense],backgroundColor:['#71edcd','#a69aff','#ffb67d'],borderWidth:0}]},options:{responsive:true,maintainAspectRatio:false,cutout:'68%',plugins:{legend:{position:'bottom',labels:{color:'#a8b7cb',usePointStyle:true,padding:15}}}}});
    $('#finance-summary-line').innerHTML=`<span>دخل مسجل: <strong>${money(income)}</strong></span><span>مصروفات: <strong>${money(expense)}</strong></span><span>صافي الحركات: <strong>${money(income-expense)}</strong></span>`;
    $('#recent-activity').innerHTML=[...allTeams].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).slice(0,6).map(t=>`<div class="activity-item"><span class="activity-bullet"><i class="fa-solid fa-user-group"></i></span><div><strong>${safe(t.teamName)} · ${safe(t.teamId)}</strong><small>${safe(t.leaderName)} · ${safe(t.institution||'جهة تعليمية غير محددة')} · ${safe(paymentLabel(statusFromPayment(t)))}</small></div></div>`).join('')||'<div class="empty-state">لا توجد تيمات بعد.</div>';
  } else {
    $('#finance-summary-line').innerHTML='';
    projectChart?.destroy();financeChart?.destroy();
    const project=owned[0]; $('#team-overview-project').innerHTML=project?renderTeamProjectCard(project):'<div class="empty-state"><i class="fa-solid fa-diagram-project"></i><strong>لسه بنربط مشروعك</strong><p>تم إنشاء حسابك، ومشروعك سيظهر هنا بمجرد مزامنة الاستوديو.</p></div>';
    $('#team-overview-project').classList.toggle('hidden',!project);
    $('#recent-activity').innerHTML=owned.slice(0,3).map(p=>`<div class="activity-item"><span class="activity-bullet"><i class="fa-solid fa-code-branch"></i></span><div><strong>${safe(p.name||'Project')}</strong><small>${safe(p.updatedAt||p.createdAt||'')} · ${safe(p.status||'planning')}</small></div></div>`).join('')||'<div class="empty-state">لم يتم تسجيل تحديثات بعد.</div>';
  }
}
function renderTeams() {
  if(!isAdmin()) return;
  const search=($('#team-search')?.value||'').trim().toLocaleLowerCase();
  let rows=allTeams.filter(t=>[t.teamId,t.teamName,t.leaderName,t.institution,t.projectName].some(v=>String(v||'').toLocaleLowerCase().includes(search)));
  rows=rows.filter(t=>teamFilter==='all'||statusFromPayment(t)===teamFilter);
  rows.sort((a,b)=>naturalCompare(a.teamId,b.teamId));
  $('#team-list-summary').innerHTML=`<span>${allTeams.length} تيم إجمالي</span><span>${allTeams.filter(t=>statusFromPayment(t)==='paid').length} مدفوع</span><span>${allTeams.filter(t=>statusFromPayment(t)==='partial').length} جزئي</span><span>${allTeams.filter(t=>statusFromPayment(t)==='unpaid').length} لم يدفع</span>`;
  $('#teams-list').innerHTML=rows.map(t=>{const f=projectFinancials(t);const s=statusFromPayment(t);return `<article class="team-row" data-team-open="${safe(t.teamId)}"><div class="team-primary"><span class="team-monogram">${safe(String(t.teamName||t.teamId).slice(0,1).toUpperCase())}</span><div><strong>${safe(t.teamName||t.teamId)}</strong><small>${safe(t.teamId)} · ${safe(t.educationLevel==='university'?'جامعة':'مدارس')}</small></div></div><div class="team-meta"><small>قائد الفريق</small><strong>${safe(t.leaderName||'غير مسجل')}</strong></div><div class="team-meta hide-mobile"><small>المشروع</small><strong>${safe(t.projectName||f.projects[0]?.name||'غير مربوط بعد')}</strong></div><div class="team-meta team-payment"><small>${paymentLabel(s)}</small><strong>${money(num(t.paidAmount))} / ${money(num(t.contractValue))}</strong></div><div class="team-row-actions"><span class="payment-badge ${s}">${paymentLabel(s)}</span><span class="round-arrow"><i class="fa-solid fa-chevron-left"></i></span></div></article>`}).join('')||'<div class="empty-state"><i class="fa-solid fa-people-group"></i><strong>مفيش تيمات مطابقة</strong><p>غيّر البحث أو الفلتر، أو أضف تيم جديد.</p></div>';
  $('#teams-list').querySelectorAll('[data-team-open]').forEach(el=>el.addEventListener('click',()=>openTeamDetail(el.dataset.teamOpen)));
}
function openTeamDetail(teamId) {
  const t=allTeams.find(x=>x.teamId===teamId); if(!t)return; const f=projectFinancials(t); const status=statusFromPayment(t);
  const related=teamProjectRows(t);
  $('#team-detail-content').innerHTML=`<div class="team-detail-top"><span class="team-monogram">${safe(String(t.teamName||t.teamId).slice(0,1))}</span><div><span class="eyebrow">TEAM FILE · ${safe(t.teamId)}</span><h2 id="team-detail-title">${safe(t.teamName)}</h2><p>${safe(t.leaderName||'')} · ${safe(t.institution||'')} · ${safe(t.educationLevel==='university'?'طلبة جامعات':'طلبة مدارس')}</p></div><span class="payment-badge ${status}">${paymentLabel(status)}</span></div>
    <div class="detail-kpis"><div class="detail-kpi"><small>قيمة التعاقد</small><strong>${money(num(t.contractValue))}</strong></div><div class="detail-kpi"><small>المدفوع</small><strong>${money(num(t.paidAmount))}</strong></div><div class="detail-kpi"><small>المتبقي</small><strong>${money(Math.max(0,num(t.contractValue)-num(t.paidAmount)))}</strong></div></div>
    <div class="detail-section"><h3>الفكرة والمخرجات</h3><div class="detail-text">${safe(t.projectIdea||'لا يوجد وصف محفوظ.')}</div><p class="detail-text">الأعضاء: ${safe(t.members||'لم تسجل أسماء الأعضاء.')}</p></div>
    <div class="detail-section"><h3>مشاريع التيم</h3><div class="team-related-projects">${related.length?related.map(p=>{const projectPaid=(Array.isArray(p.ledger)?p.ledger:[]).filter(x=>x?.type==='received').reduce((sum,x)=>sum+num(x.amount),0);return `<article class="team-related-project team-related-project-rich"><div class="team-related-project-main"><strong>${safe(p.name||'مشروع بدون اسم')}</strong><small>${safe(p.id)} · ${safe(p.status||'planning')} · ${safe(p.deadline||'موعد غير محدد')}</small></div><div class="team-related-project-actions"><button class="btn btn-ghost" type="button" data-open-studio-project="${safe(p.id)}">فتح الاستوديو</button>${related.length>1?`<button class="btn btn-ghost" type="button" data-toggle-split-project="${safe(p.id)}">فصل كتيم مستقل</button>`:''}</div>${related.length>1?`<form class="team-split-project-form hidden" data-split-project-form="${safe(p.id)}"><div class="split-project-form-heading"><strong>إنشاء دخول مستقل لهذا المشروع</strong><small>سيتم نقل ربط المشروع الحالي إلى Team ID الجديد دون نسخ المشروع أو حذف بياناته.</small></div><div class="form-grid-two"><label>Team ID الجديد<input name="teamId" required pattern="[A-Za-z0-9_-]+" minlength="3" maxlength="32" placeholder="مثال: TEAM-10"></label><label>اسم التيم<input name="teamName" required value="${safe(p.name||'تيم جديد')}"></label></div><div class="form-grid-two"><label>اسم قائد التيم<input name="leaderName" value="${safe(t.leaderName||'')}" required></label><label>المدرسة / الجامعة<input name="institution" value="${safe(p.school||t.institution||'')}"></label></div><div class="form-grid-two"><label>كلمة مرور مؤقتة<input name="password" type="password" minlength="8" required autocomplete="new-password" placeholder="8 أحرف على الأقل"></label><label>قيمة العقد لهذا المشروع (سيُخصم من التيم الأصلي)<input name="contractValue" type="number" min="0" step="0.01" value="${num(p.contractValue)}" required></label></div><div class="form-grid-two"><label>المدفوع لهذا المشروع (سيُخصم من التيم الأصلي)<input name="paidAmount" type="number" min="0" step="0.01" value="${projectPaid}" required></label><label>ملاحظة مالية<input name="financeNote" placeholder="راجع التوزيع قبل الحفظ"></label></div><small class="split-project-warning">راجع العقد والدفعات لهذا المشروع قبل الحفظ؛ سيتم خصم القيم المدخلة من إجمالي التيم الأصلي. لا تُنسخ حركات المحفظة المركزية حتى لا تتكرر.</small><button class="btn btn-primary workspace-submit" type="submit">إنشاء حساب وفصل المشروع</button></form>`:''}</article>`;}).join(''):'<p class="detail-text">لا توجد مشاريع مرتبطة حاليًا. اربط مشروعًا من القائمة التالية.</p>'}</div><div class="detail-actions"><select id="assign-project-select" class="workspace-form" style="min-width:240px;background:#081425;color:#eaf2ff;border:1px solid #263b56;border-radius:9px;padding:10px"><option value="">اختار مشروعًا لربطه...</option>${allProjects.map(p=>`<option value="${safe(p.id)}">${safe(p.name||p.id)}${p.teamId?` (Team ID: ${safe(p.teamId)})`:' (غير مربوط)'}</option>`).join('')}</select><button id="assign-project-btn" class="btn btn-ghost" type="button">ربط المشروع</button></div></div>
    <div class="detail-section"><h3>إصدار / تغيير كلمة مرور التيم</h3><p class="detail-text">الحسابات القديمة في My-Sen تقدر تستخدم نفس Team ID؛ تغيير كلمة المرور لا ينسخ المشروع ولا يمسح بياناته.</p><form id="team-password-form" class="workspace-form"><label>كلمة المرور الجديدة<input name="newPassword" type="password" minlength="8" required autocomplete="new-password" placeholder="8 أحرف على الأقل"></label><button class="btn btn-ghost workspace-submit" type="submit">حفظ كلمة مرور التيم</button></form></div>
    <div class="detail-section"><h3>تسجيل دفعة جديدة</h3><form id="team-payment-form" class="workspace-form"><div class="form-grid-two"><label>قيمة الدفعة<input name="amount" type="number" min="0.01" step="0.01" required></label><label>تاريخ التحصيل<input name="date" type="date" value="${today()}" required></label></div><div class="form-grid-two"><label>طريقة الدفع<select name="account"><option>Instapay</option><option>Cash</option><option>Bank Transfer</option><option>Vodafone Cash</option><option>Other</option></select></label><label>رقم التحويل / مرجع<input name="reference" placeholder="اختياري"></label></div><label>ملاحظة داخلية<textarea name="note" rows="2" placeholder="تفاصيل الدفعة"></textarea></label><button class="btn btn-primary workspace-submit" type="submit">حفظ التحصيل</button></form></div>`;
  $('#team-detail-modal').classList.remove('hidden');
  $('#assign-project-btn').onclick=()=>assignProjectToTeam(teamId,$('#assign-project-select').value);
  $('#team-detail-content').querySelectorAll('[data-open-studio-project]').forEach(button=>button.addEventListener('click',()=>{const projectId=button.dataset.openStudioProject;$('#team-detail-modal').classList.add('hidden');showPage('studio');window.openStudioForTeam?.(teamId,projectId);if(!window.openStudioForTeam)window.selectStudioProject?.(projectId);}));
  $('#team-detail-content').querySelectorAll('[data-toggle-split-project]').forEach(button=>button.addEventListener('click',()=>{const id=button.dataset.toggleSplitProject;const form=$(`#team-detail-content [data-split-project-form="${CSS.escape(id)}"]`);if(form)form.classList.toggle('hidden');}));
  $('#team-detail-content').querySelectorAll('[data-split-project-form]').forEach(form=>form.addEventListener('submit',event=>separateProjectIntoTeam(event,teamId,form.dataset.splitProjectForm)));
  $('#team-payment-form').onsubmit=e=>recordTeamPayment(e,teamId);
  $('#team-password-form').onsubmit=e=>resetTeamPassword(e,teamId);
}
async function separateProjectIntoTeam(event, oldTeamId, projectId) {
  event.preventDefault();
  if (!isAdmin()) return;
  const form=event.currentTarget, fd=new FormData(form);
  const newId=normalizeTeamId(fd.get('teamId'));
  const password=String(fd.get('password')||'');
  const project=allProjects.find(item=>item.id===projectId);
  const oldTeam=allTeams.find(item=>normalizeTeamId(item.teamId)===normalizeTeamId(oldTeamId));
  if (!project || !oldTeam) return showToast('لم يتم العثور على المشروع أو التيم الأصلي.','error');
  if (!window.mysenDb) return showToast('اتصال Studio غير متاح؛ لم يتم إنشاء حساب جديد. حدّث الصفحة وتأكد من اتصال Firebase.', 'error');
  if (reservedIds.has(newId)) return showToast('Team ID محجوز؛ اختار ID آخر.','error');
  if (allTeams.some(item=>normalizeTeamId(item.teamId)===newId)) return showToast('Team ID موجود بالفعل.','error');
  if (!/^[A-Z0-9_-]{3,32}$/.test(newId)) return showToast('استخدم Team ID من 3 إلى 32 حرفًا/رقمًا دون مسافات.','error');
  if (password.length<8) return showToast('كلمة المرور يجب أن تكون 8 أحرف على الأقل.','error');
  const otherProjects=teamProjectRows(oldTeam).filter(item=>item.id!==projectId);
  if (!otherProjects.length) return showToast('هذا هو المشروع الوحيد للتيم؛ استخدم تعديل بيانات التيم بدل الفصل.','error');
  const teamName=String(fd.get('teamName')||'').trim();
  const leaderName=String(fd.get('leaderName')||'').trim();
  const institution=String(fd.get('institution')||'').trim();
  const contractValue=Math.max(0,num(fd.get('contractValue')));
  const paidAmount=Math.max(0,num(fd.get('paidAmount')));
  const email=makeOpaqueAuthEmail(newId);
  let authCredential=null, recordsCommitted=false, stage='إنشاء حساب Firebase Authentication';
  setBusy(form,true);
  try {
    const directoryRef=doc(appDb,'teamLoginDirectory',newId);
    const existingDirectory=await getDoc(directoryRef);
    if(existingDirectory.exists()) throw new Error('Team ID مستخدم بالفعل في دليل الدخول.');
    authCredential=await createProvisionedAccount(email,password);
    const targetUid=authCredential.user.uid;
    const nowIso=new Date().toISOString();
    const newTeam={
      teamId:newId,teamName,leaderName,members:String(project.teamMembers||oldTeam.members||''),
      educationLevel:oldTeam.educationLevel==='university'?'university':'school',institution,
      projectName:String(project.name||teamName),projectIdea:String(project.description||project.problem||oldTeam.projectIdea||''),
      contractValue,paidAmount,currency:oldTeam.currency||'EGP',paymentStatus:statusFromPayment({contractValue,paidAmount}),
      ownerUid:targetUid,projectId,sourceProjectIds:[projectId],sourceLinked:true,createdAt:nowIso,createdBy:session?.teamId||'NEXTRONICS',financeReviewRequired:true
    };
    stage='حفظ صلاحيات التيم الجديد';
    const batch=writeBatch(appDb);
    batch.set(doc(appDb,'workspaceUsers',targetUid),{uid:targetUid,teamId:newId,teamName,leaderName,role:'team',active:true,sourceUid:targetUid,sourceLinked:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(appDb,'studio_access',targetUid),{role:'team',teamId:newId,displayName:teamName,active:true,createdAt:nowIso});
    batch.set(doc(appDb,'workspaceTeams',newId),newTeam);
    batch.set(directoryRef,{teamId:newId,uid:targetUid,authEmail:email,active:true,version:1,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    const oldContract=num(oldTeam.contractValue), oldPaid=num(oldTeam.paidAmount);
    const remainingContract=Math.max(0,oldContract-contractValue);
    const remainingPaid=Math.max(0,oldPaid-paidAmount);
    batch.set(doc(appDb,'workspaceTeams',normalizeTeamId(oldTeamId)),{
      projectId:otherProjects[0]?.id||null,projectName:String(otherProjects[0]?.name||oldTeam.projectName||''),
      sourceProjectIds:otherProjects.map(item=>item.id),
      contractValue:remainingContract,paidAmount:remainingPaid,
      paymentStatus:statusFromPayment({contractValue:remainingContract,paidAmount:remainingPaid}),
      financeReviewRequired:true,updatedAt:serverTimestamp()
    },{merge:true});
    const movedProject={...project,teamId:newId,teamNumber:newId,updatedAt:nowIso};
    // Same Firebase project/database: commit the team credentials and project assignment together.
    batch.set(doc(appDb,'studio_projects',projectId),{teamId:newId,teamNumber:newId,updatedAt:nowIso},{merge:true});
    await batch.commit();
    recordsCommitted=true;
    stage='تحديث عرض المشروع الخاص بالتيم';
    let viewSyncWarning=false;
    try {
      await window.removeTeamProjectView?.(oldTeamId,projectId);
      await window.publishTeamProjectView?.(movedProject);
    } catch(viewError) { viewSyncWarning=true; console.warn('Project is assigned to the new team, but its team view needs refresh.',viewError); }
    await signOut(provisionerAuth).catch(()=>{});
    showToast(viewSyncWarning?`تم إنشاء ${newId} ونقل ربط المشروع. لكن عرض المشروع للتيم الجديد يحتاج تحديث قواعد studio_team_views.`:`تم إنشاء ${newId} وربط المشروع الحالي به دون نسخه. راجع تخصيص الدفعات القديمة قبل اعتماد الأرقام المالية.`, viewSyncWarning?'error':'success');
    await refreshAll();
    openTeamDetail(normalizeTeamId(oldTeamId));
  } catch(error) {
    if(!recordsCommitted && authCredential?.user && provisionerAuth.currentUser?.uid===authCredential.user.uid) await deleteUser(provisionerAuth.currentUser).catch(()=>{});
    await signOut(provisionerAuth).catch(()=>{});
    console.error('Separate project into own team failed at',stage,error);
    showToast(recordsCommitted?`تم حفظ حساب التيم. المرحلة «${stage}» تحتاج مراجعة؛ لا تعِد إنشاء الحساب. المشروع ${projectId} وTeam ID ${newId}. ${authMessage(error)}`:`تعذر إنشاء التيم المستقل في مرحلة «${stage}». ${authMessage(error)}`,'error');
    if (recordsCommitted) await refreshAll().catch(refreshError=>console.warn('Refresh after project split failure',refreshError));
  } finally { setBusy(form,false); }
}

async function assignProjectToTeam(teamId,projectId) {
  const p=allProjects.find(x=>x.id===projectId);if(!p)return showToast('اختار مشروعًا من القائمة.','error');
  try {
    const priorTeam = normalizeTeamId(p.teamId || '');
    if (priorTeam && priorTeam !== normalizeTeamId(teamId)) {
      if (!confirm(`المشروع مربوط حاليًا بالتيم ${priorTeam}. هل تريد نقله إلى ${normalizeTeamId(teamId)}؟`)) return;
      await removeTeamProjectView(priorTeam, projectId).catch(console.warn);
    }
    const updatedProject = {...p,teamId:normalizeTeamId(teamId),teamNumber:normalizeTeamId(teamId),updatedAt:new Date().toISOString()};
    await window.mysenDb.collection('studio_projects').doc(projectId).set({teamId:updatedProject.teamId,teamNumber:updatedProject.teamNumber,updatedAt:updatedProject.updatedAt},{merge:true});
    await publishTeamProjectView(updatedProject);
    showToast('تم ربط المشروع بالتيم في قاعدة My-Sen.','success'); await refreshAll(); openTeamDetail(teamId);
  }
  catch(error){showToast('تعذر ربط المشروع. راجع صلاحيات Firestore: '+authMessage(error),'error');}
}
async function resetTeamPassword(event, teamId) {
  event.preventDefault(); if (!isAdmin()) return;
  const form=event.currentTarget; const fd=new FormData(form); const password=String(fd.get('newPassword')||'');
  const id=normalizeTeamId(teamId); const team=allTeams.find(item=>normalizeTeamId(item.teamId)===id);
  if (!team) return showToast('لم يتم العثور على ملف التيم في القائمة.','error');
  if (password.length < 8) return showToast('كلمة المرور يجب أن تكون 8 أحرف على الأقل.','error');
  setBusy(form,true);
  let authCredential=null;
  let recordsCommitted=false;
  let stage='قراءة دليل دخول التيم';
  try {
    const directoryRef=doc(appDb,'teamLoginDirectory',id);
    const directorySnap=await getDoc(directoryRef);
    const oldDirectory=directorySnap.exists()?directorySnap.data():null;
    const oldUid=oldDirectory?.uid || team.ownerUid || null;
    const email=makeOpaqueAuthEmail(id);
    stage='إنشاء هوية Firebase جديدة';
    authCredential=await createProvisionedAccount(email,password);
    const newUid=authCredential.user.uid;
    const cleanTeam={
      teamId:id,teamName:String(team.teamName||id),leaderName:String(team.leaderName||''),members:String(team.members||''),
      educationLevel:team.educationLevel==='university'?'university':'school',institution:String(team.institution||''),projectName:String(team.projectName||teamProjectRows(team)[0]?.name||'').trim(),
      projectIdea:String(team.projectIdea||teamProjectRows(team)[0]?.description||teamProjectRows(team)[0]?.problem||''),
      contractValue:num(team.contractValue),paidAmount:num(team.paidAmount),currency:team.currency||'EGP',paymentStatus:statusFromPayment(team),
      ownerUid:newUid,projectId:team.projectId||teamProjectRows(team)[0]?.id||null,sourceLinked:true,updatedAt:new Date().toISOString(),createdAt:team.createdAt||new Date().toISOString()
    };
    stage='حفظ مستندات الصلاحيات ودليل الدخول';
    const batch=writeBatch(appDb);
    batch.set(doc(appDb,'workspaceUsers',newUid),{uid:newUid,teamId:id,teamName:cleanTeam.teamName,leaderName:cleanTeam.leaderName,role:'team',active:true,sourceUid:newUid,sourceLinked:true,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
    batch.set(doc(appDb,'studio_access',newUid),{role:'team',teamId:id,displayName:cleanTeam.teamName,active:true,createdAt:new Date().toISOString()});
    batch.set(doc(appDb,'workspaceTeams',id),cleanTeam,{merge:true});
    batch.set(directoryRef,{teamId:id,uid:newUid,authEmail:email,active:true,version:Number(oldDirectory?.version||0)+1,createdAt:oldDirectory?.createdAt||serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    if(oldUid && oldUid!==newUid){
      batch.set(doc(appDb,'workspaceUsers',oldUid),{active:false,role:'disabled',updatedAt:serverTimestamp()},{merge:true});
      batch.set(doc(appDb,'studio_access',oldUid),{active:false,role:'disabled',updatedAt:new Date().toISOString()},{merge:true});
    }
    await batch.commit();
    recordsCommitted=true;
    await signOut(provisionerAuth).catch(()=>{});

    // When issuing credentials for a Studio-only historical team, attach its existing
    // project to the new Team ID; do not clone or delete the source project.
    let projectLinkWarning=null;
    const existingProject=teamProjectRows(team)[0];
    if(existingProject && window.mysenDb){
      stage='ربط المشروع القديم بحساب التيم الجديد';
      const oldTeamNumber=String(existingProject.teamNumber||'').trim();
      const linkedProject={...existingProject,teamId:id,teamNumber:(!oldTeamNumber||oldTeamNumber.toLowerCase()==='unknown')?id:oldTeamNumber,updatedAt:new Date().toISOString()};
      try {
        await window.mysenDb.collection('studio_projects').doc(existingProject.id).set({teamId:linkedProject.teamId,teamNumber:linkedProject.teamNumber,updatedAt:linkedProject.updatedAt},{merge:true});
        await publishTeamProjectView(linkedProject);
      } catch(linkError) {
        projectLinkWarning=linkError;
        console.warn('Credentials were issued but the historical Studio project could not be linked:',linkError);
      }
    }
    form.reset();
    await refreshAll();
    openTeamDetail(id);
    if(projectLinkWarning) showToast('تم إصدار كلمة المرور وحفظ الصلاحيات، لكن ربط المشروع القديم لم يكتمل. راجع صلاحيات studio_projects وstudio_team_views.','error');
    else showToast('تم إصدار كلمة مرور جديدة للتيم وتحديث الصلاحيات. تم الحفاظ على المشروع الأصلي دون نسخه أو حذفه.','success');
  } catch(error) {
    if(!recordsCommitted && authCredential?.user && provisionerAuth.currentUser?.uid===authCredential.user.uid) await deleteUser(provisionerAuth.currentUser).catch(()=>{});
    await signOut(provisionerAuth).catch(()=>{});
    console.error('Password rotation failed at stage:',stage,error);
    if(recordsCommitted) {
      showToast(`تم حفظ الحساب والصلاحيات، لكن تعذر إكمال مرحلة لاحقة (${stage}). لا تعِد إنشاء الحساب؛ حدّث الصفحة وراجع البيانات. ${authMessage(error)}`,'error');
      await refreshAll().catch(refreshError=>console.warn('Post-commit refresh failed',refreshError));
    } else {
      showToast(`تعذر تحديث كلمة المرور أثناء مرحلة: ${stage}. ${authMessage(error)}`,'error');
    }
  } finally { setBusy(form,false); }
}
async function recordTeamPayment(event,teamId) {
  event.preventDefault();
  const t=allTeams.find(x=>normalizeTeamId(x.teamId)===normalizeTeamId(teamId));
  if(!t)return;
  const fd=new FormData(event.currentTarget); const amount=num(fd.get('amount'));
  if(amount<=0)return showToast('اكتب مبلغًا صحيحًا.','error');
  const id=normalizeTeamId(teamId);
  const tx={type:'income',teamId:id,amount,date:String(fd.get('date')||today()),account:String(fd.get('account')||'Instapay'),category:'Team payment',party:t.teamName,reference:String(fd.get('reference')||''),note:String(fd.get('note')||''),source:'workspace-ledger',createdBy:session.teamId,createdAt:serverTimestamp()};
  try {
    const transactionRef=doc(collection(appDb,'workspaceTransactions'));
    const newPaid=num(t.paidAmount)+amount;
    const updated={teamId:id,teamName:String(t.teamName||id),leaderName:String(t.leaderName||''),members:String(t.members||''),educationLevel:t.educationLevel==='university'?'university':'school',institution:String(t.institution||''),projectName:String(t.projectName||''),projectIdea:String(t.projectIdea||''),contractValue:num(t.contractValue),paidAmount:newPaid,currency:t.currency||'EGP',paymentStatus:statusFromPayment({...t,paidAmount:newPaid}),ownerUid:t.ownerUid||null,projectId:t.projectId||teamProjectRows(t)[0]?.id||null,sourceLinked:true,updatedAt:serverTimestamp()};
    const batch=writeBatch(appDb);
    batch.set(transactionRef,tx);
    batch.set(doc(appDb,'workspaceTeams',id),updated,{merge:true});
    await batch.commit();
    const project=teamProjectRows(t)[0]; let studioSyncWarning=false;
    if(project && window.mysenDb){
      const ledger=Array.isArray(project.ledger)?project.ledger.slice():[];
      ledger.push({id:`pay-${Date.now()}`,type:'received',amount,date:tx.date,note:`${tx.account} · ${tx.reference} ${tx.note}`.trim(),source:'workspace'});
      await window.mysenDb.collection('studio_projects').doc(project.id).set({ledger,updatedAt:new Date().toISOString()},{merge:true}).catch(e=>{studioSyncWarning=true;console.warn('Central payment was saved but the Studio project ledger could not be mirrored',e);});
    }
    $('#team-detail-modal').classList.add('hidden');
    showToast(studioSyncWarning?'تم تسجيل الدفعة في المحفظة وتحديث التيم، لكن تعذر مزامنتها مع سجل المشروع داخل Studio.':'تم تسجيل الدفعة وتحديث حالة التيم في عملية واحدة.','success');
    await refreshAll();
  } catch(error){showToast('تعذر تسجيل الدفعة: '+authMessage(error),'error');}
}
function renderFinance() {
  if(!isAdmin()) return;
  const income=financeRows.filter(x=>x.type==='income').reduce((s,x)=>s+num(x.amount),0);
  const expense=financeRows.filter(x=>x.type==='expense').reduce((s,x)=>s+num(x.amount),0);
  const transfers=financeRows.filter(x=>x.type==='transfer').reduce((s,x)=>s+num(x.amount),0);
  const purchases=financeRows.filter(x=>x.type==='purchase').reduce((s,x)=>s+num(x.amount),0);
  const openDue=allTeams.reduce((s,t)=>s+Math.max(0,num(t.contractValue)-num(t.paidAmount)),0);
  $('#finance-kpis').innerHTML=[kpi('fa-solid fa-arrow-trend-up','دخل مسجل',money(income),'السجل المركزي + التحصيل التاريخي من Studio'),kpi('fa-solid fa-arrow-trend-down','مصروفات دفترية',money(expense),'الحركات المسجلة كمدفوعات فعلية'),kpi('fa-solid fa-boxes-stacked','مشتريات مواد موثقة',money(purchases),'سجل مشتريات Studio منفصل لتجنب التكرار'),kpi('fa-solid fa-arrows-rotate','تحويلات محافظ',money(transfers),'حركات داخلية لا تُضاف للدخل'),kpi('fa-solid fa-hourglass-half','مستحقات التيمات',money(openDue),'قيمة التعاقد ناقص التحصيل على ملفات التيم')].join('');
  const sorted=financeRows.slice().sort((a,b)=>String(b.date||'').localeCompare(String(a.date||'')));
  $('#finance-transactions').innerHTML=`<table class="workspace-table"><thead><tr><th>التاريخ</th><th>الحركة</th><th>التيم</th><th>التصنيف / الحساب</th><th>الطرف</th><th>المبلغ</th><th>الملاحظات</th><th>المصدر / الإجراء</th></tr></thead><tbody>${sorted.map(x=>`<tr><td>${safe(x.date||'')}</td><td><span class="payment-badge ${x.type==='income'?'paid':x.type==='expense'?'unpaid':x.type==='purchase'?'partial':'partial'}">${x.type==='income'?'دخل':x.type==='expense'?'مصروف':x.type==='purchase'?'شراء موثق':'تحويل'}</span></td><td>${safe(x.teamId||'عام')}</td><td>${safe(x.category||'')}<small>${safe(x.account||'')}</small></td><td>${safe(x.party||'')}</td><td><strong>${money(x.amount)}</strong></td><td>${safe(x.note||'')}<small>${safe(x.reference||'')}</small></td><td>${x.source==='workspace-ledger'&&!(x.type==='income'&&x.teamId)?`<button class="btn-ghost" data-delete-tx="${safe(x.id)}" type="button">حذف</button>`:`<small>${x.source==='studio-ledger'?'My-Sen / سجل تاريخي':x.source==='studio-purchase'?'My-Sen / مشتريات': 'سجل مرتبط / لا يُحذف من هنا'}</small>`}</td></tr>`).join('')||'<tr><td colspan="8">لا توجد حركات مالية مسجلة.</td></tr>'}</tbody></table><p class="finance-source-note">المشتريات الموثقة تظهر كنوع مستقل ولا تدخل في إجمالي المصروفات الدفترية تلقائيًا؛ راجع عدم تكرارها قبل تسجيل نفس الفاتورة كمصروف نقدي.</p>`;
  $('#finance-transactions').querySelectorAll('[data-delete-tx]').forEach(b=>b.onclick=async()=>{if(!confirm('حذف الحركة المالية؟'))return;try{const x=financeRows.find(t=>t.id===b.dataset.deleteTx);if(!x||x.source!=='workspace-ledger'){showToast('السجل التاريخي يُعدّل من مصدره الأصلي.','error');return;}if(x.type==='income'&&x.teamId){showToast('لا تحذف التحصيل من السجل العام فقط؛ حدّث سجل التيم لتجنب اختلاف الأرصدة.','error');return;}const mod=await import('https://www.gstatic.com/firebasejs/12.7.0/firebase-firestore.js');await mod.deleteDoc(doc(appDb,'workspaceTransactions',b.dataset.deleteTx));await refreshAll();showToast('تم حذف الحركة.','success')}catch(e){showToast(authMessage(e),'error')}});
  cashflowChart?.destroy();const ctx=$('#cashflow-chart');if(ctx&&window.Chart){const months={};financeRows.filter(x=>x.type==='income'||x.type==='expense').forEach(x=>{const key=String(x.date||today()).slice(0,7);months[key] ||= {income:0,expense:0};months[key][x.type]+=num(x.amount)});const keys=Object.keys(months).sort().slice(-8);cashflowChart=new Chart(ctx,{type:'line',data:{labels:keys,datasets:[{label:'دخل',data:keys.map(k=>months[k].income),borderColor:'#71edcd',backgroundColor:'rgba(113,237,205,.09)',tension:.3,fill:true},{label:'مصروف',data:keys.map(k=>months[k].expense),borderColor:'#ff9ba8',backgroundColor:'rgba(255,155,168,.07)',tension:.3,fill:true}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#a6b6ca'}}},scales:{x:{ticks:{color:'#8ba0bb'},grid:{display:false}},y:{ticks:{color:'#8ba0bb'},grid:{color:'rgba(142,161,187,.1)'}}}}});}
}
async function saveFinanceTransaction(event) {
  event.preventDefault(); if(!isAdmin())return;const form=event.currentTarget,fd=new FormData(form);const type=String(fd.get('type'));const amount=num(fd.get('amount'));if(amount<=0)return showToast('اكتب مبلغًا أكبر من صفر.','error');
  const data={type,amount,date:String(fd.get('date')||today()),account:String(fd.get('account')||'Other'),teamId:normalizeTeamId(fd.get('teamId')||''),category:String(fd.get('category')||''),party:String(fd.get('party')||''),note:String(fd.get('note')||''),source:'workspace-ledger',createdBy:session.teamId,createdAt:serverTimestamp()};
  if(type==='transfer'&&!data.note)data.note='تحويل داخلي بين المحافظ؛ لا يُحسب دخلًا أو مصروفًا.';
  try{await addDoc(collection(appDb,'workspaceTransactions'),data);form.reset();form.elements.namedItem('date').value=today();await refreshAll();showToast('تم حفظ الحركة المالية.','success');}catch(error){showToast('تعذر حفظ الحركة: '+authMessage(error),'error');}
}
function renderTeamProjectCard(p) {
  const timeline=Array.isArray(p.timeline)?p.timeline:[];
  const done=timeline.filter(step=>step.status==='done').length;
  const pct=timeline.length?Math.round(done*100/timeline.length):0;
  const statusLabel=({planning:'قيد التخطيط',active:'جارٍ التنفيذ',review:'مراجعة واختبار',delivered:'تم التسليم',paused:'متوقف مؤقتًا'})[p.status]||'قيد التخطيط';
  const material=(p.materials||[]).map(item=>`<div class="team-material"><strong>${safe(item.name||'مادة')}</strong><small>المطلوب: ${safe(item.quantity??1)} · تم طلبه: ${safe(item.quantityOrdered??0)} · تم شراؤه: ${safe(item.quantityPurchased??0)} · تم استلامه: ${safe(item.quantityReceived??0)} · متبقي للشراء: ${safe(item.remainingToBuy??Math.max(0,num(item.quantity)-num(item.quantityPurchased)))} · ${safe(materialStatus(item.status))}${item.clientUpdate?`<br>${safe(item.clientUpdate)}`:''}</small>${item.publicPhotoUrl?`<a class="team-project-file-link" href="${safe(item.publicPhotoUrl)}" target="_blank" rel="noopener">عرض صورة الاستلام</a>`:''}</div>`).join('')||'<p class="detail-text">قائمة المواد لم يتم نشرها بعد.</p>';
  const steps=timeline.map((step,i)=>`<div class="team-step"><strong>${i+1}. ${safe(step.title||'خطوة')}</strong><small>${safe(stepLabel(step.status))}${step.dueDate?` · موعد: ${safe(step.dueDate)}`:''}${step.owner?` · مسؤول: ${safe(step.owner)}`:''}${step.clientUpdate?`<br>${safe(step.clientUpdate)}`:''}</small>${step.description?`<p>${safe(step.description)}</p>`:''}</div>`).join('')||'<p class="detail-text">خارطة التنفيذ ستظهر بعد مراجعة المشروع.</p>';
  const tasks=(p.tasks||[]).map((task,i)=>`<div class="team-step"><strong>${i+1}. ${safe(task.title||task.name||'مهمة')}</strong><small>${safe(({todo:'لم تبدأ',planned:'لم تبدأ',active:'قيد التنفيذ',done:'مكتملة',blocked:'متوقفة'})[task.status]||task.status||'لم تبدأ')}${task.dueDate?` · موعد: ${safe(task.dueDate)}`:''}${task.assignedTo?` · المسؤول: ${safe(task.assignedTo)}`:''}</small>${task.description?`<p>${safe(task.description)}</p>`:''}</div>`).join('')||'<p class="detail-text">لا توجد مهام فرعية منشورة للتيم حتى الآن.</p>';
  const members=(p.members||[]).map(member=>`<span>${safe(member.name||member.role||'عضو فريق')}</span>`).join('');
  const mtgs=(p.meetings||[]).map(meeting=>`<div class="team-step"><strong>${safe(meeting.title||meeting.kind||'اجتماع المشروع')}</strong><small>${safe(String(meeting.dateTime||'').replace('T',' '))}${meeting.status?` · ${safe(meeting.status)}`:''}</small>${meeting.link?`<p><a class="btn-ghost" href="${safe(meeting.link)}" target="_blank" rel="noopener">فتح رابط الاجتماع</a></p>`:''}</div>`).join('');
  const media=(p.media||[]).map(item=>`<div class="team-step"><strong>${safe(item.title||'ملف مشروع')}</strong><small>${safe(item.kind||'رابط')} ${item.addedAt?`· ${safe(item.addedAt)}`:''}</small>${item.url?`<p><a class="team-project-file-link" href="${safe(item.url)}" target="_blank" rel="noopener">فتح الملف</a></p>`:''}</div>`).join('')||'<p class="detail-text">لم ينشر الأدمن ملفات للفريق بعد.</p>';
  const contract=Math.max(0,num(p.finance?.contract));
  const received=Math.max(0,num(p.finance?.received));
  const due=Math.max(0,num(p.finance?.due));
  const moneyCard=(label,value,kind='')=>`<div class="team-finance-kpi ${kind}"><small>${label}</small><strong>${money(value)}</strong></div>`;
  const section=(title,sub,body,open=false)=>`<details class="team-project-section"${open?' open':''}><summary><span>${title}</span><small>${sub}</small><i class="fas fa-chevron-down"></i></summary><div class="team-project-section-body">${body}</div></details>`;
  const overview=`<div class="team-project-overview-grid"><div><small>الجهة / المدرسة</small><strong>${safe(p.school||'غير محددة')}</strong></div><div><small>نوع المشروع</small><strong>${safe(p.projectType||'مشروع هندسي')}</strong></div><div><small>بداية التنفيذ</small><strong>${safe(p.startDate||'لم تحدد')}</strong></div><div><small>موعد التسليم</small><strong>${safe(p.deadline||'لم يحدد')}</strong></div></div><p class="detail-text">${safe(p.description||p.problem||'فكرة المشروع قيد المراجعة.')}</p>${p.deliverables?`<div class="team-project-deliverables"><strong>المخرجات المستهدفة</strong><p>${safe(p.deliverables)}</p></div>`:''}<div class="team-member-chips">${members||`<span>${safe(p.teamMembers||'لم يتم إضافة الأعضاء')}</span>`}</div><small class="team-project-last-updated">آخر تحديث: ${safe(p.updatedAt||p.createdAt||'لم يتم تسجيله')}</small>`;
  const finance=`<div class="team-finance-grid">${moneyCard('قيمة الاتفاق',contract)}${moneyCard('تم تحصيله',received,'received')}${moneyCard('المتبقي',due,due>0?'outstanding':'received')}</div><p class="muted-mini">الملخص يعرض بيانات تيمك فقط ولا يكشف مصروفات الموردين أو هامش ربح المشروع.</p>`;
  return `<article class="team-project-card"><div class="team-project-header"><div><span class="eyebrow">${safe(p.teamId||session.teamId)} · PROJECT FILE</span><h2>${safe(p.name||'مشروع التيم')}</h2><p>${safe(p.description||p.problem||'فكرة المشروع قيد المراجعة.')}</p></div><span class="status-badge">${statusLabel}</span></div><div class="team-project-head-stats"><div><strong>${pct}%</strong><small>إنجاز الخطة</small></div><div><strong>${timeline.length}</strong><small>خطوات رئيسية</small></div><div><strong>${(p.materials||[]).length}</strong><small>بنود مواد</small></div></div><div class="team-progress"><span style="width:${pct}%"></span></div><div class="team-project-sections">${section('ملخص المشروع والفريق','المعلومات الأساسية',overview,true)}${section('الخريطة الزمنية','مراحل التنفيذ',`<div class="team-step-list">${steps}</div>`)}${section('المهام والتكليفات','المهام الفرعية',`<div class="team-step-list">${tasks}</div>`)}${section('المواد والتوريدات','المطلوب والمشتَرى والمستَلَم',`<div class="team-material-list">${material}</div>`)}${mtgs?section('الاجتماعات والروابط','مواعيد المشروع',`<div class="team-step-list">${mtgs}</div>`):''}${section('الملفات والأدلة المنشورة','روابط مشاركة من الأدمن',`<div class="team-step-list">${media}</div>`)}${section('الحساب المالي للتيم','الاتفاق والتحصيل والمتبقي',finance)}</div></article>`;
}
function stepLabel(s){return ({planned:'لم تبدأ',active:'قيد التنفيذ',done:'مكتملة',blocked:'متوقفة'})[s]||'لم تبدأ'}
function materialStatus(s){return ({planned:'لم تُطلب بعد',ordered:'تم طلبها',bought:'تم الشراء',partial:'تم استلام جزء',received:'تم الاستلام',missing:'ناقصة'})[s]||'قيد التجهيز'}
function renderTeamProjects(){if(isAdmin())return;const own=allProjects.filter(p=>normalizeTeamId(p.teamId)===normalizeTeamId(session.teamId));$('#team-projects-list').innerHTML=own.map(renderTeamProjectCard).join('')||'<div class="empty-state"><i class="fa-solid fa-link"></i><strong>لم تتم مزامنة مشروعك</strong><p>لو سجلت التيم جديدًا ولم يظهر المشروع، غالبًا صلاحيات قاعدة My-Sen تحتاج إعدادًا. تواصل مع الإدارة.</p></div>';}
function timeToMinutes(value){const [h,m]=String(value||'').split(':').map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:NaN;}
function displaySlot(slot){return `${slot.date||''} · ${slot.startTime||'--:--'}–${slot.endTime||'--:--'}`;}
function renderMeetingSlots(){
  const select=$('#meeting-slot-select');
  if(select){const current=select.value;const available=meetingSlots.filter(s=>s.status==='available');select.innerHTML='<option value="">'+(slotLoadError?'تعذر تحميل المواعيد؛ راجع قواعد Firebase':'اختر الموعد المناسب...')+'</option>'+available.map(s=>`<option value="${safe(s.id)}">${safe(displaySlot(s))}</option>`).join('');if(current&&available.some(s=>s.id===current))select.value=current;select.disabled=!!slotLoadError||available.length===0;}
  const adminList=$('#meeting-admin-slots');
  if(!adminList||!isAdmin())return;
  if(slotLoadError){adminList.innerHTML=`<div class="meeting-error-state">تعذر تحميل المواعيد المتاحة: ${safe(slotLoadError)}<br>أضف قواعد workspaceMeetingSlots ثم حدّث الصفحة.</div>`;return;}
  const rows=meetingSlots.slice().sort((a,b)=>`${a.date||''}T${a.startTime||''}`.localeCompare(`${b.date||''}T${b.startTime||''}`));
  adminList.innerHTML=rows.map(slot=>`<article class="meeting-slot-row"><div><strong>${safe(displaySlot(slot))}</strong><small>${slot.status==='available'?'متاح للحجز':`محجوز · ${safe(slot.teamName||slot.teamId||'تيم')} · ${safe(slot.projectName||'')}`}</small></div><span class="status-badge ${slot.status==='available'?'slot-available':'slot-booked'}">${slot.status==='available'?'متاح':'محجوز'}</span>${slot.status==='available'?`<button type="button" class="btn-ghost" data-delete-slot="${safe(slot.id)}">حذف الموعد</button>`:''}</article>`).join('')||'<div class="empty-state"><i class="fa-regular fa-calendar"></i><strong>لم تحدد أوقاتًا متاحة بعد</strong><p>اختر اليوم والفترة بالأعلى لإنشاء مواعيد 30 أو 45 أو 60 دقيقة.</p></div>';
  adminList.querySelectorAll('[data-delete-slot]').forEach(button=>button.onclick=()=>deleteAvailableSlot(button.dataset.deleteSlot));
}
function renderMeetings() {
  const projectSelect=$('#meeting-project-select');
  if(projectSelect){const previous=projectSelect.value;const projects=isAdmin()?allProjects:allProjects.filter(p=>normalizeTeamId(p.teamId)===normalizeTeamId(session.teamId));projectSelect.innerHTML=projects.map(p=>`<option value="${safe(p.id)}">${safe(p.name||p.id)}</option>`).join('')||'<option value="">لا يوجد مشروع مرتبط بحسابك</option>';if(previous&&projects.some(p=>p.id===previous))projectSelect.value=previous;projectSelect.disabled=projects.length===0;}
  renderMeetingSlots();
  const requests=meetingRows.slice();sortRowsByDate(requests);const target=$('#meeting-requests-list');if(!target)return;
  const statusText={pending:'بانتظار مراجعة الإدارة',scheduled:'تم اعتماد الموعد',done:'تم الاجتماع',rejected:'تم رفض الطلب',cancelled:'ألغى التيم الطلب'};
  const content=requests.map(r=>{
    const canCancel=!isAdmin()&&r.status==='pending'&&normalizeTeamId(r.teamId)===normalizeTeamId(session?.teamId);
    const adminActions=isAdmin()&&r.status==='pending'?`<div class="meeting-approve-box"><label>رابط Google Meet بعد الاعتماد<input type="url" data-meet-link-input="${safe(r.id)}" placeholder="https://meet.google.com/..." value="${safe(r.meetLink||'')}"></label><div class="meeting-request-actions"><button class="btn btn-primary" data-meeting-approve="${safe(r.id)}" type="button">اعتماد وإرسال الرابط</button><button class="btn-ghost" data-meeting-reject="${safe(r.id)}" type="button">رفض وإتاحة الموعد</button></div></div>`:isAdmin()&&r.status==='scheduled'?`<button class="btn-ghost" data-meeting-close="${safe(r.id)}" type="button">تسجيل اكتمال الاجتماع</button>`:'';
    return `<article class="meeting-request"><span class="meeting-request-icon"><i class="fa-solid fa-calendar-day"></i></span><div><strong>${safe(r.title||r.kind||'طلب اجتماع')} ${isAdmin()?`· ${safe(r.teamName||r.teamId||'')}`:''}</strong><small>${safe(r.appointmentDate||r.date||String(r.dateTime||'').replace('T',' '))} ${r.startTime?`· ${safe(r.startTime)}–${safe(r.endTime||'')}`:''} · ${safe(statusText[r.status]||r.status||'قيد المراجعة')}</small>${r.projectName?`<p class="meeting-project-name">المشروع: ${safe(r.projectName)}</p>`:''}<p>${safe(r.note||'لا توجد ملاحظات إضافية.')}</p>${r.meetLink?`<a class="btn-ghost" href="${safe(r.meetLink)}" target="_blank" rel="noopener">فتح Google Meet</a>`:''}</div><div class="meeting-request-actions">${canCancel?`<button class="btn-ghost" data-meeting-cancel="${safe(r.id)}" type="button">إلغاء الطلب</button>`:''}${adminActions}</div></article>`;
  }).join('');
  const status=$('#meeting-requests-status');if(status)status.textContent=isAdmin()?`طلبات الفرق: ${requests.length} · معلّق: ${requests.filter(r=>r.status==='pending').length} · معتمد: ${requests.filter(r=>r.status==='scheduled').length}`:`طلبات تيمك: ${requests.length} · المعتمد: ${requests.filter(r=>r.status==='scheduled').length}`;
  target.innerHTML=meetingLoadError?`<div class="meeting-error-state">تعذر قراءة طلبات الاجتماعات من Firestore: ${safe(meetingLoadError)}. راجع صلاحية القراءة لمسار workspaceMeetingRequests.</div>`:content||'<div class="empty-state"><i class="fa-solid fa-calendar-check"></i><strong>لا توجد طلبات اجتماعات</strong><p>'+(isAdmin()?'عندما يحجز أي تيم موعدًا سيظهر طلبه هنا، ويمكنك اعتماده وإضافة رابط Google Meet.':'احجز أحد المواعيد المتاحة، وستظهر حالة طلبك هنا فقط.')+'</p></div>';
  target.querySelectorAll('[data-meeting-approve]').forEach(b=>b.onclick=()=>approveMeeting(b.dataset.meetingApprove));
  target.querySelectorAll('[data-meeting-reject]').forEach(b=>b.onclick=()=>rejectMeeting(b.dataset.meetingReject));
  target.querySelectorAll('[data-meeting-cancel]').forEach(b=>b.onclick=()=>cancelMeetingRequest(b.dataset.meetingCancel));
  target.querySelectorAll('[data-meeting-close]').forEach(b=>b.onclick=async()=>{try{await updateDoc(doc(appDb,'workspaceMeetingRequests',b.dataset.meetingClose),{status:'done',updatedAt:serverTimestamp()});await refreshAll();showToast('تم تسجيل اكتمال الاجتماع.','success');}catch(e){showToast(authMessage(e),'error');}});
}
async function createMeetingSlots(event){
  event.preventDefault();if(!isAdmin())return;const form=event.currentTarget;const fd=new FormData(form);const date=String(fd.get('date')||'');const start=String(fd.get('startTime')||'');const end=String(fd.get('endTime')||'');const duration=num(fd.get('slotMinutes')||30);const from=timeToMinutes(start),to=timeToMinutes(end);
  if(!date||!Number.isFinite(from)||!Number.isFinite(to)||to<=from||!duration)return showToast('راجع التاريخ وبداية ونهاية الفترة؛ النهاية لازم تكون بعد البداية.','error');
  const created=[];const occupied=meetingSlots.filter(s=>s.date===date);for(let m=from;m+duration<=to;m+=duration){const a=`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;const finish=m+duration;const b=`${String(Math.floor(finish/60)).padStart(2,'0')}:${String(finish%60).padStart(2,'0')}`;const overlaps=occupied.some(s=>{const x=timeToMinutes(s.startTime),y=timeToMinutes(s.endTime);return Number.isFinite(x)&&Number.isFinite(y)&&m<y&&finish>x;});if(!overlaps)created.push({date,startTime:a,endTime:b,startsAt:new Date(`${date}T${a}:00`).toISOString(),endsAt:new Date(`${date}T${b}:00`).toISOString(),status:'available',teamId:null,teamName:null,projectId:null,projectName:null,bookingRequestId:null,createdAt:serverTimestamp(),createdByUid:session.uid});}
  if(!created.length)return showToast('كل الفترات المحددة موجودة بالفعل أو تتداخل مع موعد آخر.','error');
  try{const batch=writeBatch(appDb);created.forEach(item=>batch.set(doc(collection(appDb,'workspaceMeetingSlots')),item));await batch.commit();form.reset();form.elements.namedItem('startTime').value='11:00';form.elements.namedItem('endTime').value='13:00';form.elements.namedItem('slotMinutes').value='30';await loadMeetingSlots();renderMeetings();showToast(`تم إنشاء ${created.length} موعدًا متاحًا.`, 'success');}catch(error){showToast(authMessage(error),'error');}
}
async function deleteAvailableSlot(id){if(!isAdmin())return;const slot=meetingSlots.find(s=>s.id===id);if(!slot||slot.status!=='available')return showToast('لا يمكن حذف موعد محجوز.','error');try{await deleteDoc(doc(appDb,'workspaceMeetingSlots',id));await loadMeetingSlots();renderMeetings();showToast('تم حذف الموعد المتاح.','success');}catch(error){showToast(authMessage(error),'error');}}
async function submitMeetingRequest(event){
  event.preventDefault();const form=event.currentTarget;if(!(form instanceof HTMLFormElement))return showToast('تعذر تحديد نموذج الحجز. حدّث الصفحة وحاول مرة أخرى.','error');const fd=new FormData(form);const project=allProjects.find(p=>p.id===fd.get('projectId'));const slotId=String(fd.get('slotId')||'');const slot=meetingSlots.find(s=>s.id===slotId&&s.status==='available');if(!project)return showToast('لا يوجد مشروع صالح مرتبط بتيمك.','error');if(!slot)return showToast('الموعد لم يعد متاحًا؛ حدّث قائمة المواعيد واختر موعدًا آخر.','error');
  const requestRef=doc(collection(appDb,'workspaceMeetingRequests'));const slotRef=doc(appDb,'workspaceMeetingSlots',slotId);const teamId=normalizeTeamId(session.teamId);const item={requestId:requestRef.id,teamId,teamName:session.teamName||teamId,projectId:project.id,projectName:project.name||project.id,slotId,appointmentDate:slot.date,startTime:slot.startTime,endTime:slot.endTime,startsAt:slot.startsAt||`${slot.date}T${slot.startTime}`,dateTime:slot.startsAt||`${slot.date}T${slot.startTime}`,kind:String(fd.get('kind')||'متابعة التنفيذ'),title:String(fd.get('kind')||'اجتماع'),note:String(fd.get('note')||''),status:'pending',createdAt:serverTimestamp(),createdByUid:session.uid};
  try{await runTransaction(appDb,async tx=>{const fresh=await tx.get(slotRef);if(!fresh.exists()||fresh.data().status!=='available')throw new Error('الموعد تم حجزه للتو من تيم آخر؛ اختر موعدًا بديلًا.');tx.set(requestRef,item);tx.update(slotRef,{status:'booked',teamId,teamName:item.teamName,projectId:project.id,projectName:item.projectName,bookingRequestId:requestRef.id,bookedAt:serverTimestamp()});});form.reset();await refreshAll();showToast('تم حجز الفترة وإرسال الطلب للإدارة. لن تظهر الفترة للتيمات الأخرى.','success');}catch(error){showToast(error?.message?.includes('حجزه للتو')?error.message:authMessage(error),'error');}
}
async function cancelMeetingRequest(id){if(isAdmin())return;const requestRef=doc(appDb,'workspaceMeetingRequests',id);try{await runTransaction(appDb,async tx=>{const requestSnap=await tx.get(requestRef);if(!requestSnap.exists())throw new Error('طلب الاجتماع غير موجود.');const row=requestSnap.data();if(normalizeTeamId(row.teamId)!==normalizeTeamId(session.teamId)||row.status!=='pending')throw new Error('يمكن إلغاء الطلبات المعلّقة الخاصة بتيمك فقط.');let slotSnap=null;let slotRef=null;if(row.slotId){slotRef=doc(appDb,'workspaceMeetingSlots',row.slotId);slotSnap=await tx.get(slotRef);}tx.update(requestRef,{status:'cancelled',cancelledAt:serverTimestamp(),updatedAt:serverTimestamp()});if(slotSnap?.exists()&&slotSnap.data().bookingRequestId===id&&slotSnap.data().status==='booked')tx.update(slotRef,{status:'available',teamId:null,teamName:null,projectId:null,projectName:null,bookingRequestId:null,releasedAt:serverTimestamp()});});await refreshAll();showToast('تم إلغاء الطلب وإعادة الموعد إلى قائمة الأوقات المتاحة.','success');}catch(error){showToast(error?.message||authMessage(error),'error');}}
async function rejectMeeting(id){if(!isAdmin())return;const requestRef=doc(appDb,'workspaceMeetingRequests',id);try{await runTransaction(appDb,async tx=>{const requestSnap=await tx.get(requestRef);if(!requestSnap.exists())throw new Error('الطلب غير موجود.');const row=requestSnap.data();let slotRef=null,slotSnap=null;if(row.slotId){slotRef=doc(appDb,'workspaceMeetingSlots',row.slotId);slotSnap=await tx.get(slotRef);}tx.update(requestRef,{status:'rejected',rejectedAt:serverTimestamp(),updatedAt:serverTimestamp()});if(slotSnap?.exists()&&slotSnap.data().bookingRequestId===id)tx.update(slotRef,{status:'available',teamId:null,teamName:null,projectId:null,projectName:null,bookingRequestId:null,releasedAt:serverTimestamp()});});await refreshAll();showToast('تم رفض الطلب وإعادة إتاحة الفترة.','success');}catch(error){showToast(authMessage(error),'error');}}
async function approveMeeting(id){if(!isAdmin())return;const row=meetingRows.find(x=>x.id===id);if(!row)return;const input=$(`[data-meet-link-input="${CSS.escape(id)}"]`);const url=String(input?.value||row.meetLink||'').trim();if(!/^https:\/\/meet\.google\.com\/[A-Za-z0-9-]+(?:\?.*)?$/.test(url))return showToast('أدخل رابط Google Meet صحيحًا يبدأ بـ https://meet.google.com/','error');try{await updateDoc(doc(appDb,'workspaceMeetingRequests',id),{meetLink:url,status:'scheduled',approvedAt:serverTimestamp(),updatedAt:serverTimestamp(),scheduledByUid:session.uid});if(row.slotId)await updateDoc(doc(appDb,'workspaceMeetingSlots',row.slotId),{bookingStatus:'approved',meetLink:url,approvedAt:serverTimestamp()});if(row.projectId&&window.mysenDb){const project=allProjects.find(p=>p.id===row.projectId);if(project){const meetings=Array.isArray(project.meetings)?project.meetings.filter(m=>m.sourceRequestId!==id):[];meetings.push({id:`request-${id}`,sourceRequestId:id,title:row.kind||'اجتماع متابعة',dateTime:row.startsAt||row.dateTime,link:url,status:'scheduled',notes:row.note||'',teamId:row.teamId});await window.mysenDb.collection('studio_projects').doc(project.id).set({meetings,updatedAt:new Date().toISOString()},{merge:true}).catch(e=>console.warn('Project meeting mirror failed',e));}}await refreshAll();showToast('تم اعتماد الموعد وإرسال رابط Google Meet للتيم.','success');}catch(error){showToast(authMessage(error),'error');}}
function renderConsultations(){
  const list=$('#consultation-thread-list');if(!list)return;
  if(consultationLoadError){list.innerHTML=`<div class="meeting-error-state">تعذر تحميل الاستشارات: ${safe(consultationLoadError)}. راجع قواعد workspaceConsultations.</div>`;renderConsultationDetail();return;}
  const needsReply=consultationRows.filter(row=>row.status!=='closed'&&((isAdmin()&&row.lastSenderRole==='team')||(!isAdmin()&&row.lastSenderRole==='admin'))).length;const count=$('#consultation-alert-count');if(count){count.textContent=String(needsReply);count.classList.toggle('hidden',needsReply===0);}
  list.innerHTML=consultationRows.map(row=>`<button type="button" class="consultation-thread-item ${row.id===selectedConsultationId?'active':''}" data-consultation-thread="${safe(row.id)}"><strong>${safe(row.subject||'استشارة بدون عنوان')}</strong><small>${isAdmin()?`${safe(row.teamName||row.teamId)} · `:''}${safe(row.status==='closed'?'مغلقة':'مفتوحة')} ${((isAdmin()&&row.lastSenderRole==='team')||(!isAdmin()&&row.lastSenderRole==='admin'))?'· رسالة جديدة':''}</small><span>${safe(row.lastMessage||'لا توجد رسائل بعد')}</span></button>`).join('')||'<div class="empty-state compact"><i class="fa-solid fa-comments"></i><strong>لا توجد استشارات بعد</strong><p>يمكن للتيم بدء استشارة من النموذج بالأعلى.</p></div>';
  list.querySelectorAll('[data-consultation-thread]').forEach(b=>b.onclick=async()=>{selectedConsultationId=b.dataset.consultationThread;await loadConsultationMessages().catch(console.error);renderConsultations();subscribeConsultationMessages(selectedConsultationId);});
  renderConsultationDetail();
}
function renderConsultationDetail(){
  const detail=$('#consultation-thread-detail'),reply=$('#consultation-reply-form');if(!detail||!reply)return;const thread=consultationRows.find(x=>x.id===selectedConsultationId);
  if(!thread){detail.innerHTML='<div class="empty-state"><i class="fa-solid fa-comments"></i><strong>اختر استشارة</strong><p>ستظهر الرسائل والردود هنا.</p></div>';reply.classList.add('hidden');return;}
  detail.innerHTML=`<header class="consultation-detail-head"><div><h3>${safe(thread.subject||'استشارة')}</h3><p>${safe(thread.teamName||thread.teamId||'')} · ${safe(thread.status==='closed'?'مغلقة':'مفتوحة')}</p></div>${isAdmin()&&thread.status!=='closed'?`<button class="btn-ghost" type="button" data-close-consultation="${safe(thread.id)}">إغلاق الاستشارة</button>`:''}</header><div class="consultation-messages">${consultationMessages.map(message=>`<article class="consultation-message ${message.senderRole==='admin'?'from-admin':'from-team'}"><div class="consultation-message-meta"><strong>${safe(message.senderName||(message.senderRole==='admin'?'NEXTRONIC Admin':thread.teamName||thread.teamId))}</strong><small>${safe(message.createdAt?.toDate?message.createdAt.toDate().toLocaleString('ar-EG'):message.createdAt?new Date(message.createdAt).toLocaleString('ar-EG'):'الآن')}</small></div>${message.message?`<p>${safe(message.message)}</p>`:''}${(message.attachments||[]).map(file=>`<div class="consultation-attachment">${file.contentType?.startsWith('image/')?`<a href="${safe(file.url)}" target="_blank" rel="noopener"><img src="${safe(file.url)}" alt="${safe(file.name)}"></a>`:''}<a href="${safe(file.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-paperclip"></i> ${safe(file.name)}</a><small>${Math.ceil((file.size||0)/1024)} KB</small></div>`).join('')}</article>`).join('')||'<div class="empty-state compact"><strong>لا توجد رسائل</strong></div>'}</div>`;
  reply.classList.toggle('hidden',thread.status==='closed');reply.dataset.threadId=thread.id;
  detail.querySelector('[data-close-consultation]')?.addEventListener('click',()=>closeConsultation(thread.id));
  const messages=detail.querySelector('.consultation-messages');if(messages)messages.scrollTop=messages.scrollHeight;
}
async function uploadConsultationAttachments(teamId,threadId,files){
  const output=[];if(!files.length)return output;if(!window.mysenStorage)throw new Error('Firebase Storage غير متاح. تأكد من إعداد Storage وقواعده.');
  for(const file of files){if(file.size>10*1024*1024)throw new Error(`الملف ${file.name} أكبر من 10 MB.`);const safeName=file.name.replace(/[^\w.\-\u0600-\u06FF]/g,'_').slice(0,120)||'attachment';const path=`workspace-consultations/${canonicalTeamId(teamId)}/${threadId}/${Date.now()}-${safeName}`;const upload=await window.mysenStorage.ref(path).put(file,{contentType:file.type||'application/octet-stream'});const url=await upload.ref.getDownloadURL();output.push({name:file.name,url,storagePath:path,contentType:file.type||'application/octet-stream',size:file.size});}
  return output;
}
async function saveConsultationMessage(threadId,message,files){
  const thread=consultationRows.find(row=>row.id===threadId);if(!thread)throw new Error('الاستشارة غير موجودة.');if(thread.status==='closed')throw new Error('الاستشارة مغلقة؛ افتح استشارة جديدة لو عندك سؤال آخر.');
  const attachments=await uploadConsultationAttachments(thread.teamId,threadId,files);const msgRef=doc(collection(appDb,'workspaceConsultations',threadId,'messages'));const body=String(message||'').trim();if(!body&&!attachments.length)throw new Error('اكتب رسالة أو اختر ملفًا للإرسال.');
  await setDoc(msgRef,{teamId:thread.teamId,threadId,senderUid:session.uid,senderRole:isAdmin()?'admin':'team',senderName:isAdmin()?'NEXTRONIC Admin':(session.teamName||session.teamId),message:body,attachments,createdAt:serverTimestamp()});
  await updateDoc(doc(appDb,'workspaceConsultations',threadId),{lastMessage:body||(attachments.length?`مرفق: ${attachments.map(f=>f.name).join(', ')}`:''),lastSenderRole:isAdmin()?'admin':'team',lastMessageAt:serverTimestamp(),updatedAt:serverTimestamp()});
}
async function createConsultationThread(event){event.preventDefault();if(isAdmin())return;const form=event.currentTarget,fd=new FormData(form);const subject=String(fd.get('subject')||'').trim(),message=String(fd.get('message')||'').trim(),files=[...(form.elements.namedItem('attachments')?.files||[])];if(!subject||(!message&&!files.length))return showToast('اكتب عنوان الاستشارة والرسالة أو أرفق ملفًا.','error');try{const threadRef=doc(collection(appDb,'workspaceConsultations'));const row={teamId:normalizeTeamId(session.teamId),teamName:session.teamName||session.teamId,subject,status:'open',lastMessage:message||'مرفق',lastSenderRole:'team',createdByUid:session.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessageAt:serverTimestamp()};await setDoc(threadRef,row);const localRow={...row,id:threadRef.id};consultationRows=[localRow,...consultationRows];selectedConsultationId=threadRef.id;await saveConsultationMessage(threadRef.id,message,files);form.reset();await refreshAll();selectedConsultationId=threadRef.id;await loadConsultationMessages();renderConsultations();subscribeConsultationMessages(threadRef.id);showToast('تم إرسال الاستشارة إلى الإدارة.','success');}catch(error){console.error(error);showToast(authMessage(error),'error');}}
async function sendConsultationReply(event){event.preventDefault();const form=event.currentTarget;const threadId=form.dataset.threadId||selectedConsultationId;const fd=new FormData(form);const message=String(fd.get('message')||'').trim();const files=[...(form.elements.namedItem('attachments')?.files||[])];try{await saveConsultationMessage(threadId,message,files);form.reset();await refreshAll();selectedConsultationId=threadId;await loadConsultationMessages();renderConsultations();subscribeConsultationMessages(threadId);showToast('تم إرسال الرسالة.','success');}catch(error){console.error(error);showToast(error?.message||authMessage(error),'error');}}
async function closeConsultation(id){if(!isAdmin())return;try{await updateDoc(doc(appDb,'workspaceConsultations',id),{status:'closed',closedAt:serverTimestamp(),updatedAt:serverTimestamp()});await refreshAll();selectedConsultationId=id;renderConsultations();showToast('تم إغلاق الاستشارة.','success');}catch(error){showToast(authMessage(error),'error');}}
async function createAdminTeam(event){event.preventDefault();if(!isAdmin())return;const form=event.currentTarget,fd=new FormData(form);const id=normalizeTeamId(fd.get('teamId'));const password=String(fd.get('password')||'');if(reservedIds.has(id))return showToast('Team ID محجوز؛ اختر ID آخر للتيم.','error');if(allTeams.some(t=>t.teamId===id))return showToast('Team ID موجود بالفعل.','error');setBusy(form,true);try{const status=String(fd.get('paymentPreset')||'unpaid');const contractValue=num(fd.get('contractValue'));const profile={teamName:String(fd.get('teamName')||''),leaderName:String(fd.get('leaderName')||''),educationLevel:String(fd.get('educationLevel')||'school'),institution:String(fd.get('institution')||''),members:String(fd.get('members')||''),projectName:String(fd.get('projectName')||''),projectIdea:String(fd.get('projectIdea')||''),contractValue,paidAmount:status==='paid'?contractValue:(status==='partial'?Math.min(contractValue,Math.max(0,num(fd.get('initialPayment')))):0)};await createTeamRecord({teamId:id,password,profile,fromAdmin:true});form.reset();$('#create-team-modal').classList.add('hidden');await refreshAll();showToast('تم إنشاء التيم وربط بياناته. شارك Team ID وكلمة المرور مع الليدر فقط.','success');}catch(error){console.error(error);showToast('لم يكتمل إنشاء التيم: '+authMessage(error),'error');}finally{setBusy(form,false);}}
function exportFinanceCSV(){if(!isAdmin())return;const rows=[['Date','Type','Team ID','Account','Category','Party','Amount EGP','Reference','Note','Source'],...financeRows.map(x=>[x.date,x.type,x.teamId,x.account,x.category,x.party,x.amount,x.reference,x.note,x.source])];const csv='\ufeff'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download=`nextronic-finance-${today()}.csv`;a.click();URL.revokeObjectURL(a.href);}
async function requestProjectUpdate(){if(!session||isAdmin())return;const body=prompt('اكتب التحديث أو المعلومة التي تريد مراجعتها:');if(body===null||!body.trim())return;try{const threadRef=doc(collection(appDb,'workspaceConsultations'));const subject='طلب تحديث مشروع';const row={teamId:normalizeTeamId(session.teamId),teamName:session.teamName||session.teamId,subject,status:'open',lastMessage:body.trim(),lastSenderRole:'team',createdByUid:session.uid,createdAt:serverTimestamp(),updatedAt:serverTimestamp(),lastMessageAt:serverTimestamp()};await setDoc(threadRef,row);const messageRef=doc(collection(appDb,'workspaceConsultations',threadRef.id,'messages'));await setDoc(messageRef,{teamId:row.teamId,threadId:threadRef.id,senderUid:session.uid,senderRole:'team',senderName:session.teamName||session.teamId,message:body.trim(),attachments:[],createdAt:serverTimestamp()});await refreshAll();selectedConsultationId=threadRef.id;await loadConsultationMessages();renderConsultations();subscribeConsultationMessages(threadRef.id);showToast('تم إرسال التحديث إلى صندوق الاستشارات.','success');}catch(e){showToast(authMessage(e),'error');}}
function bindEvents(){
  $('#team-login-form').addEventListener('submit',loginTeam);$('#finance-transaction-form').addEventListener('submit',saveFinanceTransaction);$('#meeting-request-form').addEventListener('submit',submitMeetingRequest);$('#meeting-slot-form')?.addEventListener('submit',createMeetingSlots);$('#consultation-new-form')?.addEventListener('submit',createConsultationThread);$('#consultation-reply-form')?.addEventListener('submit',sendConsultationReply);$('#admin-create-team-form').addEventListener('submit',createAdminTeam);
  $('#open-create-team').onclick=()=>$('#create-team-modal').classList.remove('hidden');$('#team-search').addEventListener('input',renderTeams);$('#export-finance-csv').onclick=exportFinanceCSV;$('#request-project-update').onclick=requestProjectUpdate;
  $$('[data-team-filter]').forEach(b=>b.onclick=()=>{teamFilter=b.dataset.teamFilter;$$('[data-team-filter]').forEach(x=>x.classList.toggle('active',x===b));renderTeams()});
  $$('.workspace-nav [data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));$$('[data-go]').forEach(b=>b.onclick=()=>showPage(b.dataset.go));
  $$('[data-action="refresh"]').forEach(b=>b.onclick=async()=>{await refreshAll();showToast('تم تحديث بيانات مساحة العمل.','success')});
  $('#workspace-logout').onclick=async()=>{try{await signOut(auth);if(window.mysenAuth)await window.mysenAuth.signOut().catch(()=>{});}finally{clearWorkspaceLiveFeeds();session=null;allTeams=[];allProjects=[];financeRows=[];meetingRows=[];meetingSlots=[];consultationRows=[];consultationMessages=[];selectedConsultationId='';toggleWorkspace(false);setAuthStatus('تم تسجيل الخروج.');}};
  $('#sidebar-toggle').onclick=()=>document.body.classList.toggle('sidebar-open');$('#workspace-overlay').onclick=()=>document.body.classList.remove('sidebar-open');
  $$('[data-modal-close]').forEach(b=>b.onclick=()=>{ $('#team-detail-modal').classList.add('hidden');$('#create-team-modal').classList.add('hidden');});
}
function contactLinks(){const c=window.NEXTRONIC_CONTACT||{};const set=(name,url)=>$$(`[data-contact-link="${name}"]`).forEach(a=>{const valid=url&&!String(url).includes('YOUR_')&&!String(url).includes('XXXXXXXX');a.href=valid?url:'#';a.classList.toggle('contact-not-configured',!valid);if(name==='email'&&valid)a.href=`mailto:${url}`;if(name==='whatsapp'&&valid)a.href=`https://wa.me/${String(url).replace(/\D/g,'')}`;a.setAttribute('aria-disabled',String(!valid));if(!valid)a.addEventListener('click',e=>{e.preventDefault();alert('أضف بيانات التواصل في js/workspace-config.js أولًا.');});});set('facebook',c.facebookUrl);set('tiktok',c.tiktokUrl);set('whatsapp',c.whatsappNumber);set('email',c.email);}
function populateTeamOptions(teams){const el=$('#studio-team-id-select');if(el){const curr=el.value;el.innerHTML='<option value="">مشروع عام / غير مربوط</option>'+teams.map(t=>`<option value="${safe(t.teamId)}">${safe(t.teamId)} · ${safe(t.teamName)}</option>`).join('');if(curr)el.value=curr;}}
window.populateStudioTeamOptions=populateTeamOptions;
window.nextronicWorkspaceSession=()=>session;

bindEvents();prepareSourceApp();contactLinks();
if($('#finance-transaction-form')?.elements.namedItem('date'))$('#finance-transaction-form').elements.namedItem('date').value=today();
// Restore an already authenticated Team ID session only if it has an authorized workspace profile.
onAuthStateChanged(auth, async user=>{
  if(!user || loginInProgress)return;
  try{
    await (window.mysenAuthReady || Promise.resolve(null));
    if (!window.mysenAuth || window.mysenAuth.currentUser?.uid !== user.uid) {
      await signOut(auth).catch(()=>{});
      setAuthStatus('انتهت جلسة الاستوديو أو لم تتزامن. سجّل الدخول باستخدام Team ID وكلمة المرور مرة أخرى.','error');
      return;
    }
    const snap=await getDoc(doc(appDb,'workspaceUsers',user.uid));
    if(snap.exists()){
      const p=snap.data();
      if(p.active !== true || !['admin','team'].includes(p.role)) { await signOut(auth).catch(()=>{}); await window.mysenAuth.signOut().catch(()=>{}); return; }
      session={...p,uid:user.uid,sourceUid:user.uid,sourceLinked:true};
      await enterWorkspace(session);
    } else { await signOut(auth).catch(()=>{}); }
  }
  catch(error){console.warn('Could not restore workspace session',error);}
});
