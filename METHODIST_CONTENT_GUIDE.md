# Izlan Methodist qo‘llanmasi

> Bu qo‘llanma **metodist** uchun: Izlan platformasida dars kontentini qanday yaratish, ko‘rikdan
> o‘tkazish va nashr qilishni oddiy tilda tushuntiradi. Dasturchi bo‘lish shart emas — hamma ish
> **Content Studio** interfeysi orqali bajariladi.

---

## 1. Izlan’da Methodist nima qiladi?

Metodist — kontentning **pedagogik egasi**. Siz:

- fan kontentini boshqarasiz (mavzular, darslar tartibi);
- **dars** yaratasiz va uning matnini yozasiz;
- dars ichida **faoliyat (activity)** — tushuntirish, misol, test savoli — qo‘shasiz;
- har bir darsni **ko‘nikma (skill)** bilan bog‘laysiz;
- darslar orasidagi **talab (prerequisite)** tartibini belgilaysiz;
- kontentni **ko‘rik (review)** qilasiz;
- va nihoyat **nashr (publish)** qilasiz.

**Muhim — kontent siyosati:**

- To‘g‘rilik uchun javobgarlik **metodistda**, AI’da emas.
- AI matn yozib berishi **mumkin**, lekin metodist uni **tekshiradi**. AI o‘quv dasturining
  (curriculum) egasi emas.
- AI tayyorlagan matn **avtomatik nashr bo‘lmaydi**. Har bir narsa siz ko‘rikdan
  o‘tkazganingizdan keyingina o‘quvchiga ko‘rinadi.
- **Grammatik va faktik xatolar ko‘rikdan (review) oldin tuzatilishi shart.**
- **DRAFT (qoralama) kontent o‘quvchiga hech qachon chiqmaydi** — faqat nashr qilingan revision
  ko‘rinadi.
- **To‘g‘ri javob (answerKey)** har doim **qo‘lda** tekshiriladi.
- O‘quvchiga ko‘rinadigan matnda **texnik atamalar, content key yoki UUID (ichki identifikatorlar)**
  bo‘lmasligi kerak.

---

## 2. Kontent iyerarxiyasi (tuzilmasi)

Kontent quyidagi bosqichlardan iborat (yuqoridan pastga):

```
Fan (Subject)
  └─ Yo‘nalish (Track)
       └─ Daraja (Level)          — masalan A1
            └─ Modul (Module)
                 └─ Mavzu (Topic)
                      └─ Dars (Lesson)
                           └─ Revision (dars versiyasi)
                                └─ Faoliyat (Activity)
```

**English A1 misoli:**

- **Fan:** English — Beginner (A1)
- **Yo‘nalish:** General English A1
- **Daraja:** A1
- **Modul:** A1 Foundations
- **Mavzu:** “Tanishuv va asosiy gaplar”
- **Dars:** “Salomlashish va tanishuv”
- **Revision:** shu darsning 1-versiyasi
- **Faoliyat:** Maqsad matni, tushuntirish, misol, test savollari

O‘quvchi doim **pastki** bosqichni (dars va uning faoliyatlarini) ko‘radi; yuqori bosqichlar
tashkiliy “papka”lar.

---

## 3. Content Studio’ga kirish

1. Brauzerda **`/staff/login`** sahifasini oching.
2. Telefon raqami va parolingiz bilan kiring. *(Parolni bu hujjatga yozmang va hech kimga
   bermang.)*
3. Yuqoridagi menyudan **“Kontent”** bo‘limiga o‘ting.
4. **“Fanlar”** ro‘yxatidan sizga **biriktirilgan (assigned)** fanni tanlang.

**Diqqat:** siz faqat sizga **biriktirilgan** fanlarda ishlay olasiz. Agar kerakli fan
ko‘rinmasa, administrator sizni o‘sha fanga biriktirishi kerak (bu ADMIN huquqi —
`content.subject.manage`). Metodist o‘zini o‘zi biriktira olmaydi.

---

## 4. Yangi dars yaratish

Mavzu (Topic) ichida **“Darslar”** ro‘yxatida **yangi dars** tugmasini bosing va maydonlarni
to‘ldiring:

| Maydon | Ma’nosi | Maslahat |
|---|---|---|
| **Content key** | Darsning o‘zgarmas biznes identifikatori | Masalan `ENG-A1-001-GREETINGS`. **Keyin o‘zgarmaydi** — ehtiyot bo‘lib tanlang. |
| **Sarlavha (title)** | Darsning ko‘rinadigan nomi | O‘quvchi ko‘radi. Revision ichida yashaydi, keyin o‘zgartirsa bo‘ladi. |
| **Tartib (order/sortOrder)** | Mavzu ichidagi ketma-ketlik | Kichik son — oldinroq. Masalan 10, 20, 30. |
| **Tavsif (description)** | Qisqa izoh (ixtiyoriy) | Darsning bir jumlalik mazmuni. |

Dars yaratilganda u **Qoralama (DRAFT)** holatida bo‘ladi — ya’ni hali o‘quvchiga ko‘rinmaydi.
Dars bilan birga uning **1-revision**i (DRAFT) ochiladi; matn va faoliyatlar aynan shu revision
ichida yoziladi.

---

## Birinchi darsni qanday qo‘shaman? — tezkor misol

Yangi metodist birinchi darsini dasturchisiz oxirigacha qo‘sha oladigan qadam-baqadam yo‘l
(namuna: “Salomlashish va tanishuv” darsi):

1. **Kiring:** `/staff/login` → **Kontent** → **English — Beginner (A1)** fanini oching.
2. **Joyni toping:** A1 daraja → **A1 Foundations** moduli → **Tanishuv va asosiy gaplar** mavzusi.
3. **Dars yarating:** *yangi dars* → content key `ENG-A1-001-GREETINGS`, sarlavha
   **“Salomlashish va tanishuv”**, tartib `10`. Dars **DRAFT** bo‘lib ochiladi (1-revision).
4. **Faoliyatlar qo‘shing** (tavsiya etilgan tartibda):
   - **TEXT** — Maqsad: “Bu darsda salomlashishni o‘rganasiz.”
   - **EXPLANATION** — Hello / Good morning / Goodbye … qoidasi.
   - **EXAMPLE** — “A: Hello! B: Hi!” kabi misollar.
   - **MINI_QUESTION** — “Ertalab qaysi salom to‘g‘ri?” (bitta to‘g‘ri javob).
   - **PRACTICE** — yana bir-ikki mashq.
   - **MASTERY_TEST** — dars oxiridagi test.
5. **Ko‘nikma bog‘lang:** darsni **`ENG-A1-GREETINGS`** ko‘nikmasiga bog‘lang (aks holda dars
   o‘quvchining yo‘l xaritasiga tushmaydi).
6. **Talab (agar bo‘lsa):** birinchi dars uchun talab yo‘q; keyingi dars (`002`) buni talab
   qiladi.
7. **Ko‘ring:** **“O‘quvchi ko‘rinishi (Learner preview)”** orqali darsni o‘quvchi ko‘zi bilan
   tekshiring.
8. **Ko‘rikka yuboring:** revisionni **“Ko‘rikka”** yuboring (DRAFT → REVIEW).
9. **Nashr qiling:** **“Nashrga tayyor”** yashil bo‘lsa, **“Nashr qilish”** (REVIEW → PUBLISHED).

Shu bilan birinchi darsingiz o‘quvchiga ko‘rinadigan bo‘ladi. Keyingi darslar ham xuddi shu
tartibda.

---

## 5. Revision nima?

Bu — eng muhim tushunchalardan biri.

- **Dars (Lesson)** = darsning **barqaror shaxsi** (identifikatori). U hech qachon o‘zgarmaydi.
- **Revision (LessonRevision)** = darsning **aniq, tahrirlanadigan versiyasi** (matn + faoliyatlar).

Qoida:

- **Nashr qilingan (PUBLISHED) revision — o‘zgarmas.** Uni to‘g‘ridan-to‘g‘ri tahrirlab bo‘lmaydi.
- Nashr qilingan darsni **o‘zgartirish** kerak bo‘lsa:
  1. yangi **DRAFT revision** yarating (yoki mavjud qoralamani tahrirlang),
  2. uni **ko‘rikka (REVIEW)** yuboring,
  3. so‘ng **nashr (PUBLISH)** qiling.
- Yangi versiya nashr qilinganda, eski nashr avtomatik **arxivlanadi**. **Darsni avval boshlab
  qo‘ygan o‘quvchilar eski revisionda davom etadi** — ular chalkashmaydi.

Shunday qilib tarix saqlanadi va o‘quvchi tajribasi buzilmaydi.

---

## 6. Faoliyat (Activity) turlari

Hozir **qo‘llab-quvvatlanadigan** turlar:

**Matnli (ko‘rish uchun) — o‘quvchi o‘qiydi, keyin “Keyingisi”ni bosadi:**

| Tur | Qachon ishlatiladi | Misol |
|---|---|---|
| **TEXT** | Darsning boshi, maqsad | “## Maqsad — Bu darsda salomlashishni o‘rganasiz.” |
| **EXPLANATION** | Qoidani tushuntirish | “**Hello** — har doim ishlatsa bo‘ladigan salom …” |
| **EXAMPLE** | Tayyor misollar | “A: Hello! B: Hi!” |

**Test (obyektiv) — o‘quvchi javob tanlaydi, tizim tekshiradi:**

| Tur | Qachon ishlatiladi | Misol |
|---|---|---|
| **MINI_QUESTION** | Tushunishni tez tekshirish (tushuntirishdan keyin) | “She ___ a teacher.” → is |
| **PRACTICE** | Amaliy mashq | “We ___ from Samarkand.” → are |
| **MASTERY_TEST** | Dars oxiridagi yakuniy tekshiruv | “I ___ a teacher.” → am |

**Hozircha QO‘LLAB-QUVVATLANMAYDI (ishlatmang):** SPEAKING, WRITING, LISTENING, AI_INTERACTION,
VIDEO. IMAGE va AUDIO ham hozircha to‘liq ishlamaydi — matnli darslar bilan cheklaning.

### Matn (Markdown) haqida muhim eslatma

Dars matnida quyidagi **oddiy va xavfsiz** vositalar ishlaydi (boshqa hech narsa — HTML ham,
skript ham — ishlamaydi, ular oddiy matn bo‘lib ko‘rinadi):

| Nima | Qanday yoziladi | Nimaga ishlatiladi |
|---|---|---|
| **Sarlavha** | `#`, `##`, `###` | mavzuni bo‘limlarga ajratish |
| **Qalin matn** | `**shu tarzda**` | muhim so‘z/shaklni ajratish |
| **Ro‘yxat** | har qatorda `-` | sanab o‘tish |
| **Qoida kartasi (jadval)** | `\| Ustun \| Ustun \|` + keyingi qatorda `\| --- \| --- \|` | qoida/naqsh yoki so‘z–ma’no juftliklari |
| **Eslatma (callout)** | qatorni `>` bilan boshlang | \"E’tibor bering\", \"Ko‘p uchraydigan xato\" |
| **Naqsh (inline)** | `` `Do + you + verb?` `` | grammatik shaklni ajratib ko‘rsatish |
| **Bo‘lim chizig‘i** | alohida qatorda `---` | bo‘limlarni ajratish |

Masalan, **to be** qoidasini jadval bilan ko‘rsatish:

```
| Olmosh | To be |
| --- | --- |
| I | am |
| he / she / it | is |
| you / we / they | are |
```

va **ko‘p uchraydigan xato**ni eslatma bilan:

```
> Noto‘g‘ri: He are a student.
> To‘g‘ri: He is a student.
```

Kursiv, havola (link) va rasm hozircha **ishlamaydi** — matnni shu vositalar doirasida yozing.
Yaxshi namuna: `content/pilots/english-a1/v1/` (barcha 12 dars shu uslubda yozilgan).

---

## 7. Yaxshi dars strukturasi

Tavsiya etiladigan andoza (English A1 pilotidagi kabi):

```
1. Maqsad            (TEXT)          — dars nimani o‘rgatadi
2. Tushuntirish      (EXPLANATION)   — qoidani soddagina yozing
3. Misol             (EXAMPLE)       — 2–5 aniq misol
4. Kichik savol      (MINI_QUESTION) — darhol tushunishni tekshiring
5. Eslatma/tushuntirish (EXPLANATION)— ko‘p uchraydigan xato
6. Mashq             (PRACTICE)      — amaliy savol
7. Mashq             (PRACTICE)      — yana bir mashq
8. Yakuniy tekshiruv (MASTERY_TEST)  — dars oxiridagi test
```

Har bir darsda aynan 8 ta faoliyat bo‘lishi shart emas — pedagogik mulohaza bilan tanlang. Lekin:

- dars **uzun matn devori** bo‘lmasin — qisqa bo‘laklarga bo‘ling;
- har bir tushuntirishdan keyin kamida bitta savol bo‘lgani ma’qul;
- dars **maqsad** bilan boshlanib, **yakuniy test** bilan tugasin.

---

## O‘quvchiga mavzuni qanday tushuntirish kerak?

Dars **o‘rgatishi** kerak — nafaqat tekshirishi. O‘quvchi yonida o‘qituvchi bo‘lmasa ham, dars
orqali mavzuni tushuna olishi kerak. Bu — asosiy sifat mezoni.

**Yomon dars:**

> uzun ta’rif → darhol test

Bunda o‘quvchi qoidani ko‘rmaydi, misol olmaydi va nega xato qilganini bilmaydi.

**Yaxshi dars:**

> sodda tushuntirish → **qoida/naqsh** → **misollar** → **ko‘p uchraydigan xato** → kichik savol
> → mashq → yakuniy tekshiruv

### Har bir bosqich nima beradi

1. **Maqsad** — o‘quvchi nima o‘rganishini biladi (1–3 natija, uzun paragraf emas).
2. **Tushuntirish** — bitta tushuncha, sodda o‘zbek tilida, izohsiz atamasiz.
3. **Qoida** — jadval bilan ko‘rsating, shunda o‘quvchi naqshni **ko‘radi**, o‘qib chiqmaydi.
4. **Misollar** — inglizcha + o‘zbekcha ma’no; kerak bo‘lsa tasdiq/inkor/savol qarama-qarshiligi.
5. **Ko‘p uchraydigan xato** — eslatma (`>`) bilan: *Noto‘g‘ri → To‘g‘ri* va qisqa sabab.
6. **Kichik savol** — endigina o‘rgatilgan narsani darhol tekshiring.
7. **Mashq** — asta-sekin qiyinlashib boradigan bir necha savol (bir xil savolni takrorlamang).
8. **Yakuniy tekshiruv** — dars maqsadini qamrab oladi.
9. **Xulosa** — o‘quvchi asosiy qoida bilan darsdan chiqadi.

### Haqiqiy misol — “To be: am, is, are”

- **Maqsad:** to be bilan oddiy gap tuzishni o‘rganamiz.
- **Tushuntirish:** kimligini/qandayligini/qayerdaligini aytishda to be ishlatiladi.
- **Qoida (jadval):**

  ```
  | Olmosh | To be |
  | --- | --- |
  | I | am |
  | he / she / it | is |
  | you / we / they | are |
  ```
- **Misollar:** I **am** a student. — Men talabaman. / She **is** happy. — U xursand.
- **Ko‘p uchraydigan xato:** `> Noto‘g‘ri: He are a student. → To‘g‘ri: He is a student.`
- **Kichik savol:** She ___ a doctor. (is)
- **Mashq → Yakuniy tekshiruv → Xulosa.**

Barcha 12 A1 darsi (`content/pilots/english-a1/v1/`) aynan shu uslubda yozilgan — namuna sifatida
oching.

### Media (rasm/audio) haqida

Til darslari uchun **audio** (talaffuz) va **rasm** (masalan, oila diagrammasi, kun tartibi
ketma-ketligi, soat) foydali bo‘ladi. Hozircha platformada media **yuklash quvuri tayyor emas**
(alohida keyingi bosqich), shuning uchun:

- media hozircha darsga qo‘shilmaydi;
- **hech qachon** rasm/audio havolasini yoki faylni dars JSON matniga yozib qo‘ymang.

Media qo‘shish imkoni paydo bo‘lganda, u faqat **o‘rgatadigan** joyda ishlatiladi (bezak uchun
emas): salomlashish/sonlar talaffuzi (audio), oila munosabatlari va kun tartibi (rasm).

---

## 8. Test savoli yozish qoidalari

- **Bitta aniq to‘g‘ri javob** bo‘lsin (agar format bir nechta javobga ruxsat bermasa).
- Savol **noaniq** bo‘lmasin — grammatikasi va imlosi to‘g‘ri bo‘lsin.
- **Chalg‘ituvchilar (distraktorlar)** ishonarli bo‘lsin, lekin qasddan aldamasin. Yaxshi
  chalg‘ituvchi — o‘quvchi ko‘p qiladigan xato (masalan `studys` — `studies` o‘rniga).
- **Hali o‘rgatilmagan** narsani so‘ramang.
- **To‘g‘ri javob (answerKey)** faqat tizim ichida saqlanadi — u **hech qachon** o‘quvchiga yoki
  savol matniga chiqmaydi. Uni matnga yozib qo‘ymang.

Namuna:

> **Savol:** She ___ a student.
> **Variantlar:** am / **is** / are / be
> **To‘g‘ri:** is

Savollarni bir xil qolipda takrorlamang — turlicha vaziyatlar bering.

---

## 9. Ko‘nikmalar (Skills)

**Ko‘nikma** — bu o‘quvchi egallashi kerak bo‘lgan aniq bir malaka. Masalan:

> **Dars:** “To be: am, is, are”
> **Ko‘nikmalar:** `ENG-A1-BE-AFFIRMATIVE`, `ENG-A1-SUBJECT-PRONOUNS`

Har bir darsni **kamida bitta** ko‘nikma bilan bog‘lang (**Dars ko‘nikmalari**). Test
faoliyatlarini ham mos ko‘nikma bilan belgilang (**Faoliyat ko‘nikmalari**).

**Nega bu muhim?** Ko‘nikmalar butun o‘quv yo‘lini bog‘laydi:

- **Daraja aniqlash (Placement):** test o‘quvchining ko‘nikmalarini o‘lchaydi.
- **Ko‘nikmalar profili (Skill Profile):** o‘quvchi qaysi ko‘nikmada kuchli/zaifligini ko‘radi.
- **Yo‘l xaritasi (Roadmap):** tizim **faqat o‘lchangan ko‘nikmaga bog‘langan** darslarni yo‘lga
  qo‘shadi. Ya’ni **ko‘nikma bog‘lanmagan dars o‘quvchining yo‘l xaritasiga umuman tushmaydi.**
- **Takrorlash (Review):** xato qilingan ko‘nikma keyin qайta takrorlanadi.

Shuning uchun **ko‘nikma bog‘lashni unutmang** — aks holda dars nashr qilingan bo‘lsa ham o‘quvchi
uni ko‘rmaydi. Keraksiz mayda ko‘nikmalar o‘ylab topmang; mavjud izchil ko‘nikma modelidan
foydalaning.

---

## 10. Talablar (Prerequisites)

Talab — “B darsini boshlashdan oldin A darsi bilinishi kerak” degani.

English A1 misoli (izchil tartib):

```
Salomlashish → Kishilik olmoshlari → To be (tasdiq) → To be (inkor) → To be (savollar)
→ Shaxsiy ma’lumot → Egalik → Oila → Have/has → Present Simple …
```

Qoidalar:

- Tartib **mantiqiy** bo‘lsin — oson darslar oldin.
- **Ortiqcha** talab qo‘shmang (zanjirni murakkablashtirmang).
- **Halqa (cycle) bo‘lmasin:** A → B → A mumkin emas. Tizim buni rad etadi.
- Talab qilingan dars **nashr qilingan** va **shu fanga tegishli** bo‘lishi kerak.

O‘quvchi talab qilingan darsni tugatmaguncha, keyingi dars **bloklangan (BLOCKED)** bo‘lib turadi.

---

## 11. Ko‘rik (Review) va Nashr (Publish)

Har bir revision uchta holatdan o‘tadi:

```
Qoralama (DRAFT) → Ko‘rik (REVIEW) → Nashr (PUBLISHED)
```

- **DRAFT → REVIEW:** revisionni **“Ko‘rikka”** yuborasiz (huquq: `content.author`). Tizim
  **“Ko‘rikka tayyor”** tekshiruvini bajaradi.
- **REVIEW → PUBLISHED:** revisionni **“Nashr qilish”** (huquq: `content.publish`). Tizim
  **“Nashrga tayyor”** tekshiruvini bajaradi.
- **REVIEW → DRAFT:** kerak bo‘lsa **“Qoralamaga qaytarish”** (sabab majburiy).

**To‘g‘ridan-to‘g‘ri DRAFT → PUBLISHED bo‘lmaydi** — ko‘rik bosqichi majburiy.

**Kim nima qila oladi (haqiqiy huquqlar):**

- **Metodist:** `content.author` + `content.publish` — ya’ni yozadi, ko‘rikka yuboradi **va**
  nashr qiladi.
- **ADMIN:** yuqoridagilar + `content.subject.manage` (fan yaratish, metodistni fanga biriktirish).
- Har qanday holatda ham fanga **biriktirilgan (SubjectAssignment)** bo‘lish shart — hatto ADMIN
  ham. Rol nomi bo‘yicha “chetlab o‘tish” yo‘q.

**Nashrdan oldin tizim tekshiradigan tayyorlik (readiness):**

- revisionda kamida bitta faoliyat bor va tartib raqamlari uzluksiz;
- barcha faoliyat payloadlari to‘g‘ri;
- darsning barcha yuqori bosqichlari (Mavzu, Modul, Daraja, Yo‘nalish, Fan) **nashr qilingan**;
- talab qilingan darslar nashr qilingan va shu fanga tegishli;
- dars ko‘nikmalari faol (active).

**Konteynerlarni nashr qilish** (Fan → Yo‘nalish → Daraja → Modul → Mavzu) **yuqoridan pastga**
boradi: quyi bosqichni nashr qilishdan oldin uning yuqori bosqichlari nashr qilingan bo‘lishi
kerak.

---

## 12. Bulk Import (ommaviy import)

Ko‘p darsni qo‘lda kiritish o‘rniga, tayyor **paket (JSON fayl)** import qilish mumkin.

Qachon nima:

- **Qo‘lda yaratish** — bitta-yarim dars yoki kichik tuzatishlar uchun.
- **Bulk Import** — bir butun **mavzu** (bir nechta dars + faoliyat + ko‘nikma + talab) ni
  birdaniga yuklash uchun.

Import oqimi (**“Kontent importi”** bo‘limi):

```
Fayl → Tekshirish (Validate) → Qo‘llash (Apply, DRAFT sifatida) → Ko‘rik → Nashr
```

- **Tekshirish (Validate):** hech narsa yozilmaydi; faqat fayl to‘g‘riligini ko‘rsatadi
  (xatolar, ogohlantirishlar, hisob).
- **Qo‘llash (Apply):** darslar, revisionlar, faoliyatlar, ko‘nikmalar va talablar **DRAFT**
  holatida yaratiladi.

> **Eng muhim qoida:** **Import HECH QACHON avtomatik nashr qilmaydi.** Import qilingan hamma narsa
> qoralama bo‘lib qoladi — siz uni ko‘rikdan o‘tkazib, qo‘lda nashr qilasiz.

Bir fayl = bitta **mavzu**ning kontenti. Fayl to‘g‘ridan-to‘g‘ri o‘sha mavzuga import qilinadi.
Talablar to‘g‘ri bog‘lanishi uchun fayllarni **manifest tartibi**da yuklang.

---

## 13. English A1 namunasi (pilot)

Tayyor, yaxshi tuzilgan namuna: **`content/pilots/english-a1/v1/`**

Unda: `manifest.json` (tuzilma va tartib) + 4 ta mavzu fayli (`01-…json` … `04-…json`) +
`README.md`. Jami **4 mavzu, 12 dars, 13 ko‘nikma**.

Bu paketni namuna sifatida ishlatishingiz mumkin — yaxshi paket qanday tuzilishini ko‘rsatadi.
Agar interfeys orqali ishlashni afzal ko‘rsangiz, kodni tahrirlashingiz **shart emas**.

---

## 14. Nashrdan oldingi checklist

Har bir darsni nashr qilishdan oldin tekshiring:

- [ ] Sarlavha to‘g‘ri va tushunarli
- [ ] Maqsad aniq
- [ ] Tushuntirish to‘g‘ri va sodda
- [ ] Misollar tabiiy
- [ ] Imlo xatolari yo‘q
- [ ] Mashqlar dars mazmuniga mos
- [ ] Test to‘g‘ri javoblari (answerKey) to‘g‘ri
- [ ] Ko‘nikma bog‘lanishlari to‘g‘ri (aks holda dars yo‘l xaritasiga tushmaydi)
- [ ] Talablar (prerequisites) to‘g‘ri, halqa yo‘q
- [ ] **“O‘quvchi ko‘rinishi (Learner preview)”** orqali ko‘rib chiqildi
- [ ] Qo‘llab-quvvatlanmaydigan faoliyat/media yo‘q
- [ ] **“Nashrga tayyor”** (readiness) yashil
- [ ] Ko‘rik yakunlandi

---

## 15. Nimalarni qilmaslik kerak?

- ❌ Nashr qilingan kontentni ma’lumotlar bazasi (DB) orqali to‘g‘ridan-to‘g‘ri o‘zgartirish.
- ❌ To‘g‘ri javobni (answerKey) o‘quvchiga ko‘rinadigan matnga yozish.
- ❌ Keraksiz, tasodifiy ko‘nikmalar yaratish.
- ❌ Talablarda halqa (A → B → A) hosil qilish.
- ❌ Qoralamani **ko‘rikdan o‘tkazmasdan** nashr qilishga urinish (tizim ruxsat bermaydi).
- ❌ AI tayyorlagan kontentni **tekshirmasdan** nashr qilish. To‘g‘rilik — metodist zimmasida.
- ❌ Darsni ko‘nikma bilan bog‘lashni unutish (bog‘lanmasa, o‘quvchi darsni ko‘rmaydi).
- ❌ O‘quvchiga ko‘rinadigan matnga **content key, UUID yoki texnik atama** yozish.
- ❌ Grammatik/faktik xatoni tuzatmasdan ko‘rikka yoki nashrga o‘tkazish.

---

## Ilova: Bulk Import fayli bilan ishlash (ixtiyoriy / ilg‘or)

Bu bo‘lim texnik jamoaga yoki JSON bilan ishlashni istaganlarга.

- Odatda **tayyorlangan paketlar**dan foydalaning (masalan pilot paketi). JSON’ni qo‘lda tahrirlash
  — ixtiyoriy/ilg‘or ish.
- Har bir fayl `"schemaVersion": "izlan-topic-content/v1"` bilan boshlanadi va bitta **mavzu**
  kontentini o‘z ichiga oladi: `skills[]` va `lessons[]` (har bir darsda `contentKey`,
  `skillCodes[]`, `prerequisiteContentKeys[]` va bitta `revision` — faoliyatlar bilan).
- **Har doim** yuklashdan oldin **Tekshirish (Validate)** ni ishlating.
- **Barqaror `contentKey`lari bo‘lgan** paketda yangi ID’lar o‘ylab topmang — mavjud kalitlardan
  foydalaning.
- Faoliyat turlari faqat qo‘llab-quvvatlanadiganlardan bo‘lsin (6-bo‘limga qarang).

Batafsil: `content/pilots/english-a1/v1/README.md`.
