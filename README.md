# Divane Society Demo

React Native + Expo ile hazırlanmış, aynı ağdaki cihazlar arasında senkron çalışan premium mobil uygulama prototipi. Demo API verileri `server/db.json` içinde tutulur.

## Çalıştırma

```bash
npm install
npm run dev:lan
```

İki terminal ile çalıştırmak istersen:

```bash
npm run server
EXPO_PUBLIC_API_URL=http://MAC_IP_ADRESIN:4000 npx expo start --host lan --port 8081
```

Telefonlar aynı Wi-Fi ağında olmalı. Personel QR onayladığında müşteri ekranı 5 saniye içinde veya aşağı çekip yenileyince aynı canlı veriyi görür.

## Yayına Hazırlık

Mağaza ve kapalı test hazırlığı için proje içinde şu dosyalar hazırdır:

- `eas.json`: TestFlight, Play Internal Testing ve production build profilleri
- `.env.example`: Canlı API ve demo API ortam değişkenleri
- `docs/release-checklist.md`: App Store / Google Play öncesi son kontrol
- `docs/backend-deployment.md`: Canlı API yayın planı
- `docs/privacy-policy.md`: Gizlilik politikası taslağı
- `docs/store-metadata.md`: Mağaza açıklamaları

İlk kapalı test build'i için:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npm run build:preview
```

Production mağaza build'i için:

```bash
npm run build:production
```

## Demo Girişleri

Müşteri:

- Telefon: `5551112233`
- Şifre: `1234`

Admin / Personel:

- Super Admin: `SA-001` / `1234`
- Mekan Admini: `ADM-101` / `1234`
- Personel: `PRS-210` / `1234`

## Kapsam

- Tek panel Log In / Sign Up akışı
- Türkçe demo metinleri ve tek panel giriş akışı
- Müşteri telefon + şifre, personel/yönetici atanmış ID + şifre ile aynı panelden giriş
- Oturumun açık kalması
- Divane Lounge, Divane Mey, Barney Pub mekan filtreleri
- White glassmorphism / VisionOS hissi veren premium UI
- Instagram benzeri story ve gönderi akışı
- Story tam ekran görüntüleme, kullanıcı adıyla story beğeni / yorum
- Gönderilerde 1:1 görsel, CTA, glass reaction bar, beğeni ve yorum alanı
- QR katılım, countdown, katılım ilerlemesi ve son girişler
- Tek QR tarama paneli: katılım ve ödül QR kodlarını otomatik ayırır, ödül QR tekrar okutulursa kullanılmış uyarısı verir
- Spin & Win çarkı, ödül QR kodu, sadakat analytics, rezervasyon, şikayet / istek, profil
- Personel QR ve rezervasyon operasyon ekranları
- Super Admin bildirim merkezi, toplu bildirim, müşteri sadakat paneline tek yönlü mesaj, kullanıcı verileri, story/gönderi/personel ekleme, kampanyalar ve analytics ekranları
- Ortak demo API: QR onayı, story/gönderi medya yükleme, personel, rezervasyon ve istek kayıtları cihazlar arasında paylaşılır
