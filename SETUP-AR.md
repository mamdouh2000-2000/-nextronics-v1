# دليل إعداد Nextronics على Firebase المجاني (Spark)

## الفكرة

النسخة دي لا تستخدم Cloud Functions، وبالتالي لا تحتاج نشر Functions أو ترقية Blaze لهذا المسار. شاشة المستخدم تعرض **Team ID + Password فقط**. خلف الكواليس نستخدم Firebase Authentication بطريقة Email/Password بحسابات داخلية ذات alias عشوائي، ولا نعرض الإيميل الحقيقي ولا زر Google. لازم تفعيل Email/Password من Firebase Console مرة واحدة لأنه طريقة التحقق الداخلية الوحيدة في هذا الحل المجاني. كلمات المرور لا تُحفظ في Firestore أو ملفات JavaScript.

## تجهيز الأدمن مرة واحدة

1. افتح [Firebase Console](https://console.firebase.google.com/) واختر مشروع My-Sen: `stem-battle`.
2. Authentication → Sign-in method → فعّل **Email/Password** فقط. لا تفعّل Google.
3. Authentication → Users → Add user.
   - Email: `admin-nextronic@teams.nextronic.invalid`
   - Password: كلمة المرور التي تختارها لـ Team ID `NEXTRONICS` (يمكنك استخدام نفس الكلمة التي كتبتها سابقًا في ملف `.env` المحلي إذا أردت).
   - لا تحتاج بريدًا حقيقيًا أو تفعيل بريد. إذا رفضت الواجهة نطاق `.invalid`، استخدم alias آخر يقبله Firebase Console، واكتب نفس القيمة في حقل `authEmail` بالخطوة التالية.
4. انسخ UID للحساب.
5. في Firestore أنشئ المستندات الثلاثة التالية، واستبدل `{UID}` بالـ UID الفعلي:

### `workspaceUsers/{UID}`
- `uid` — string — UID نفسه
- `teamId` — string — `NEXTRONICS`
- `teamName` — string — `NEXTRONIC`
- `leaderName` — string — `Platform Admin`
- `role` — string — `admin`
- `active` — boolean — `true`
- `sourceUid` — string — UID نفسه
- `sourceLinked` — boolean — `true`

### `studio_access/{UID}`
- `role` — string — `admin`
- `teamId` — string — `NEXTRONICS`
- `displayName` — string — `NEXTRONIC Admin`
- `active` — boolean — `true`

### `teamLoginDirectory/NEXTRONICS`
- `teamId` — string — `NEXTRONICS`
- `uid` — string — UID نفسه
- `authEmail` — string — `admin-nextronic@teams.nextronic.invalid` أو الـ alias الذي أنشأته فعلًا
- `active` — boolean — `true`
- `version` — number — `1`

6. افتح ملف `firebase/mysen-workspace-rules.append.txt`. ضع دوال المساعدة وكتل `match` داخل النطاق الحالي `match /databases/{database}/documents { ... }`. استبدل أي كتل Workspace قديمة من نسخة Functions (خصوصًا التي تعتمد `nxAdminClaim` أو custom claims) بدل تركها متداخلة، لكن حافظ على كتل My-Sen التعليمية الأخرى. **لا تستبدل قواعد المنصة التعليمية كلها** ولا تترك قاعدة أوسع مثل `allow read, write: if true` للمجموعات نفسها؛ قواعد Firestore تجمع السماحات، وأي قاعدة مطابقة واسعة قد تتجاوز القواعد الأضيق.
7. ارفع ملفات الموقع المعدّلة إلى الاستضافة الحالية.
8. افتح `workspace.html` واستخدم:
   - Team ID: `NEXTRONICS`
   - Password: كلمة المرور التي وضعتها عند إنشاء حساب Authentication.

## إنشاء التيمات وتغيير كلمات المرور

- من لوحة الأدمن أنشئ Team ID وكلمة مرور وبيانات المشروع.
- إنشاء الحساب يتم داخل Auth instance منفصلة حتى لا يخرج الأدمن من جلسته.
- تغيير كلمة مرور مشروع قديم ينشئ هوية داخلية جديدة ويربطها بالتيم الموجود، من غير نسخ أو حذف مستند المشروع الأصلي.
- الحساب القديم يظل قد يظهر في قائمة Firebase Authentication؛ لا توجد صلاحية آمنة من المتصفح لحذف حساب مستخدم آخر. يتم تعطيل وصوله في ملفات الصلاحيات، لذلك يجب مراجعة أي قواعد قديمة متداخلة قبل فتح الموقع للعامة.

## نقل سجلات Nextronics القديمة (اختياري فقط)

لو عايز تنقل بيانات الفرق والمالية والطلبات القديمة من `nextronic-b2847` إلى `stem-battle`، فيه أداة `tools/migrate-workspace-data.cjs`. دي خطوة منفصلة ومش مطلوبة لتسجيل الدخول. تحتاج مفاتيح Service Account للمشروعين محفوظة محليًا فقط، ولا ترفعها للموقع أو تبعتها في الشات. نفّذ `npm.cmd install` من جذر المشروع، واضبط المتغيرين `NEXTRONIC_SERVICE_ACCOUNT_JSON` و`MYSEN_SERVICE_ACCOUNT_JSON` كمسارات لملفات JSON المحلية، ثم شغّل Dry Run أولًا وراجع `workspace-migration-report.json` وخذ نسخة احتياطية قبل استخدام `--apply`. الأداة تنقل فقط `workspaceTeams` و`workspaceTransactions` و`workspaceMeetingRequests`، ولا تنقل مستخدمي Auth أو `workspaceUsers` أو `teamLoginDirectory` لأن معرفات Auth لا تنتقل بين المشروعات؛ بعد النقل أصدر كلمات مرور جديدة من لوحة الأدمن. مشاريع Studio الأصلية تظل في مجموعاتها داخل My-Sen.

## أوامر الفحص الاختياري

من جذر المشروع في Terminal:

```powershell
npm.cmd run check
```

لا تشغّل `firebase deploy --only functions` في هذه النسخة؛ لا توجد Functions في مسار الحل المجاني. ولا يعني نجاح فحص الصياغة أن إعداد Firebase الحي اكتمل؛ تجهيز Auth وFirestore يتم من Console مرة واحدة.


## تحديث v3.1 — ترتيب البيانات والمشاريع

- ملف `firebase/stem-battle-firestore-rules-reference.txt` مرجع قواعد كامل لمسارات المشروع المعروفة. لا تستخدم قواعد Workspace وحدها إذا كان نفس مشروع Firebase يخدم صفحات الموقع العامة. راجع المجموعات القديمة المذكورة فيه واختبرها قبل Publish.
- عدّل المشروع `workspaceTeams` صار يقرأ السجلات بدون `orderBy(createdAt)` حتى لا تختفي المستندات القديمة التي لا تحتوي ذلك الحقل.
- كل مشاريع `studio_projects` تظهر في فهرس Studio بترتيب رقمي، مع البحث والفلترة، وأقسام التفاصيل قابلة للفتح والإغلاق.
- إذا ظهرت نسخة محلية غير متزامنة أو تنبيه Firestore في أعلى Studio، لا تعتبرها بيانات سحابية مؤكدة؛ أصلح الصلاحيات ثم أعد التحميل.
- حماية الموقع تمنع إنشاء حساب مهندس من شاشة التسجيل العامة حتى يتم تكوين مسار تفويض حقيقي؛ حسابات المهندسين الحالية تظل تعمل إذا كانت قيمة `role` في `users/{UID}` هي `engineer`. خصّص `role` إلى `admin` أو `engineer` للحسابات المخوّلة من Firebase Console، ولا تسمح للمستخدم بتعيين الدور بنفسه.
- لا تنسخ كلمات المرور إلى Firestore أو الملفات. مستند `teamLoginDirectory` يحتاج قراءة دقيقة واحدة قبل تسجيل الدخول، ولذلك كل حقوله قابلة للقراءة العامة وفق القاعدة. لا تضع فيه سوى بيانات الربط اللازمة.
