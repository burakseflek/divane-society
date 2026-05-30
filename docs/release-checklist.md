# Divane Society Yayın Kontrol Listesi

Bu dosya App Store, TestFlight ve Google Play Internal Testing öncesi son kontrol için hazırlandı.

## Uygulama Kimliği

- iOS bundle id: `com.divanesociety.app`
- Android package: `com.divanesociety.app`
- Uygulama adı: `Divane Society`
- Expo slug: `divane-society`
- Versiyon: `1.0.0`

## Canlı API

Production build şu adrese bağlanacak şekilde ayarlandı:

```bash
https://api.divanesociety.app
```

Yayın öncesi bu domain gerçek API sunucusuna yönlenmeli. QR, medya, story, gönderi, rezervasyon, istek ve bildirim verileri bu servis üzerinden çalışacak.

Canlı API başlatılırken önerilen ortam değişkenleri:

```bash
PORT=4000
DIVANE_DB_DIR=/var/lib/divane-society
DIVANE_PUBLIC_API_ORIGIN=https://api.divanesociety.app
```

## EAS Build

İlk kapalı test için:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npm run build:preview
```

Production mağaza dosyaları için:

```bash
npm run build:production
```

Mağazaya gönderim için:

```bash
npm run submit:production
```

## Mağaza Hesapları

- Apple Developer hesabı aktif olmalı.
- App Store Connect içinde Divane Society uygulaması açılmalı.
- Google Play Console içinde uygulama kaydı açılmalı.
- Android için Play App Signing aktif olmalı.
- iOS ve Android için gizlilik beyanları doldurulmalı.

## İzinler

Uygulama kamera, fotoğraf/video seçimi, bildirim ve konum izni ister.

Konum izni, kullanıcı Divane mekanlarına geldiğinde QR katılım hatırlatması göndermek içindir. App Store ve Google Play incelemesinde bu açıklama aynı netlikte yazılmalı.

## Gerçek Mekan Koordinatları

`App.js` içindeki `divaneGeoRegions` değerleri mağaza öncesi gerçek koordinatlarla güncellenmeli:

- Divane Lounge
- Divane Mey
- Barney Pub

Koordinatlar kesinleşmeden konum hatırlatması production'a çıkarılmamalı.

## Son Cihaz Testleri

- Yeni müşteri kaydı
- Tek giriş panelinden müşteri/personel/admin girişi
- Story/gönderi görsel yükleme
- Story/gönderi video yükleme ve sesli oynatma
- QR katılım tarama ve müşteriye anlık yansıma
- 5/5 katılım sonrası çark hakkı
- Çark ödülü QR'ının tek kullanımlık olması
- Rezervasyon oluşturma/onaylama
- İstek/şikayet oluşturma/onaylama
- Admin toplu bildirim
- Admin kullanıcıya tek yönlü mesaj
- Uygulama kapalıyken push bildirimi
- Mekana yaklaşınca QR katılım hatırlatması
- Koyu mod ve açık mod görünümü

