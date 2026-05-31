# Canlı API Yayını

Divane Society mobil uygulaması production build'de şu API adresine bağlanacak şekilde ayarlandı:

```text
https://api.divanesociety.app
```

Bu adres gerçek bir sunucuya yönlenmeden App Store / Google Play build'i canlı verilerle çalışmaz.

## Önerilen V1 Yayın Modeli

Mevcut uygulama canlı API'ye bağlanacak şekilde hazırdır. QR, story, gönderi, video ve görsellerin kaybolmaması için API mutlaka kalıcı disk veren bir sunucuda çalışmalıdır.

Uygun seçenekler:

- Railway persistent volume
- Render persistent disk
- DigitalOcean App Platform + volume
- Küçük bir VPS

Bu V1 yayın modelinde `server.js` canlı API olarak çalışır, veriler ve medya dosyaları kalıcı diskte tutulur.

Vercel tek başına bu sürüm için ideal değildir; serverless dosya sistemi medya upload ve kalıcı JSON verisi için güvenilir değildir. Vercel kullanılacaksa Neon Postgres ve Vercel Blob gibi ayrı veritabanı/dosya depolama servisleri bağlanmalıdır.

## Ortam Değişkenleri

```bash
PORT=4000
DIVANE_DB_DIR=/data
DIVANE_PUBLIC_API_ORIGIN=https://api.divanesociety.app
```

## Railway ile Adım Adım

1. GitHub'da yeni bir repo oluştur.
2. Bu projeyi GitHub'a gönder.
3. Railway hesabına gir.
4. `New Project` seç.
5. `Deploy from GitHub repo` seç.
6. Divane Society reposunu seç.
7. Railway proje ayarlarında `Variables` bölümüne önce sadece şunu ekle:

```bash
DIVANE_DB_DIR=/data
```

İlk testte `DIVANE_PUBLIC_API_ORIGIN` ekleme. Böylece medya linkleri Railway'in geçici domaininden üretilir.

8. Railway servis ayarlarında `Volume` ekle.
9. Volume mount path değerini `/data` yap.
10. Start command olarak şunu kullan:

```bash
node server.js
```

11. Deploy tamamlanınca Railway'in verdiği geçici domain ile sağlık kontrolü yap:

```bash
https://RAILWAY-DOMAIN/api/health
```

12. Cevap `ok: true` ise API çalışıyor.

## Domain Bağlama

Domain panelinde şu kayıt açılmalı:

```text
api.divanesociety.app  CNAME  Railway'in verdiği hedef domain
```

Railway custom domain ekranı hangi CNAME hedefini veriyorsa DNS paneline birebir o yazılmalı.

DNS yayılması tamamlandıktan sonra:

```bash
https://api.divanesociety.app/api/health
```

adresinin çalışması gerekir.

Bu çalıştıktan sonra Railway `Variables` bölümüne şunu ekle veya varsa güncelle:

```bash
DIVANE_PUBLIC_API_ORIGIN=https://api.divanesociety.app
```

Ardından Railway'de yeni deploy başlat.

## EAS Ortam Değişkeni

Canlı API domaini çalıştıktan sonra Expo/EAS tarafında production ve preview ortamına şu değer girilmeli:

```bash
EXPO_PUBLIC_API_URL=https://api.divanesociety.app
```

Bu değer `eas.json` içinde de hazırdır.

Custom domain bağlanmadan önce preview testleri için geçici Railway domaini kullanılabilir:

```bash
EXPO_PUBLIC_API_URL=https://web-production-0ec71.up.railway.app
```

## Docker ile Yayın

Build:

```bash
docker build -t divane-society-api .
```

Run:

```bash
docker run -p 4000:4000 \
  -v divane-society-data:/data \
  -e DIVANE_PUBLIC_API_ORIGIN=https://api.divanesociety.app \
  divane-society-api
```

Sağlık kontrolü:

```bash
curl https://api.divanesociety.app/api/health
```

Beklenen cevap:

```json
{
  "ok": true,
  "app": "Divane Society API"
}
```
