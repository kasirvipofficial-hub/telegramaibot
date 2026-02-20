# 🤖 Bot & Video Engine Setup Guide (Versi Lokal)

Panduan ini menjelaskan cara menjalankan Bot dan Video Engine secara berdampingan di komputer Anda untuk performa maksimal.

## 1. Persiapan Video Engine
Pastikan Video Engine Anda sudah berjalan:
```bash
cd video-engine
npm run dev
```
Engine akan berjalan di `http://localhost:3000`.

## 2. Persiapan Bot Engine
1.  **Install Dependencies**:
    ```bash
    cd bot-engine
    npm install
    ```
2.  **Konfigurasi `.env`**:
    Isi token bot Anda (dari @BotFather) di `bot-engine/.env`. Pastikan `ENV_ENGINE_URL` mengarah ke `http://localhost:3000`.
3.  **Jalankan Bot**:
    ```bash
    npm run dev
    ```
    Bot akan berjalan di `http://localhost:3001`.

## 3. Ekspos Bot ke Telegram (Tunnel)
Agar Telegram bisa mengirim pesan ke bot Anda, gunakan Cloudflare Tunnel:
```bash
cloudflared tunnel --url http://localhost:3001
```
Salin URL publik yang muncul (misal: `https://xyz.trycloudflare.com`).

## 4. Aktivasi Webhook
Buka browser dan akses rute aktivasi otomatis menggunakan link tunnel Anda:
`https://xyz.trycloudflare.com/register`

Jika muncul respon `{"ok":true}`, bot Anda sudah resmi terhubung ke Telegram!

## 5. Cara Penggunaan
Ketik `/generate [Topik]` di bot Telegram Anda. Bot akan langsung memerintahkan Engine lokal untuk memproses video dan akan mengirimkannya kembali ke Anda saat selesai.

---

### Tips Penting:
*   **Kecepatan**: Karena dijalankan lokal, bot mengirimkan perintah ke engine secara instan tanpa hambatan internet.
*   **Limit 50MB**: Jika video hasil render > 50MB, Telegram tidak bisa menarik file otomatis. Bot akan memberikan link download sebagai gantinya.
