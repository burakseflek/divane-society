# Canlı API Yayını

Divane Society mobil uygulaması production build'de şu API adresine bağlanacak şekilde ayarlandı:

```text
https://api.divanesociety.app
```

Bu adres gerçek bir sunucuya yönlenmeden App Store / Google Play build'i canlı verilerle çalışmaz.

## Önerilen Basit Yayın Modeli

Mevcut API dosya tabanlıdır. QR, story, gönderi, video ve görsellerin kaybolmaması için kalıcı disk veren bir sunucu kullanılmalıdır.

Uygun seçenekler:

- Railway persistent volume
- Render persistent disk
- DigitalOcean App Platform + volume
- Küçük bir VPS

Vercel tek başına bu sürüm için ideal değildir; serverless dosya sistemi medya upload ve kalıcı JSON verisi için güvenilir değildir. Vercel kullanılacaksa veritabanı ve dosya depolama ayrıca bağlanmalıdır.

## Ortam Değişkenleri

```bash
PORT=4000
DIVANE_DB_DIR=/data
DIVANE_PUBLIC_API_ORIGIN=https://api.divanesociety.app
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

