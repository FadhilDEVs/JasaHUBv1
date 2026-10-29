# JASAhub — frontend dan backend Vercel, database Google Sheets

Paket ini merupakan salinan migrasi dari JASAhub-id-fullcode.zip versi 10.
File asli tidak ditimpa. Tidak membutuhkan URL Apps Script /exec.

## 1. Desain dan jalur file

Dua blok `<style>` dan seluruh markup HTML sebelum script disalin persis dari
index.html terbaru. Google Fonts tetap memakai URL HTTPS aslinya.
Tidak ada stylesheet lokal yang hilang atau diganti dengan framework baru.

JavaScript dipindahkan dari inline menjadi:

```html
<script src="/assets/jasahub.js" defer></script>
```

File fisiknya `public/assets/jasahub.js`. Di URL Vercel, folder `public` tidak
ikut ditulis: `/assets/jasahub.js`, bukan `/public/assets/jasahub.js`.
Logo yang semula Base64 dalam JavaScript dipindahkan menjadi `public/assets/logo.png`.
Byte gambarnya tetap identik; ini mengurangi ukuran JavaScript yang perlu diparse.
Struktur kartu, modal, hero, navigasi, CSS, SVG, dan aturan responsif dipertahankan.
Audit hash ada di `AUDIT-DESAIN.json`. Kesamaan byte CSS/markup sudah diperiksa;
kesamaan visual di browser dan koneksi Google/Vercel nyata belum diverifikasi.

## 2. Struktur proyek

| Lokasi | Fungsi |
| --- | --- |
| `api/jasa.js` | GET katalog publik, cache CDN 10 menit |
| `api/rpc.js` | POST akun, checkout, pesanan, admin; tanpa cache |
| `api/media.js` | GET gambar yang terdaftar dalam tabel Media |
| `lib/google.js` | Autentikasi Google dari server; tanpa dependency tambahan |
| `lib/sheets.js` | Baca tabel, simpan perubahan batch, koordinasi penulisan |
| `lib/schema.js` | Header tabel kompatibel dengan database lama |
| `lib/engine.js` | Aturan harga, paket, akun, hak admin, tiga status pesanan |
| `lib/media.js` | Unggah dan baca Drive |
| `lib/http.js` | Validasi request dan respons error |
| `public/index.html` | HTML dan CSS asli |
| `public/assets/jasahub.js` | JavaScript tampilan, fetch ke endpoint Vercel |
| `public/assets/logo.png` | Byte logo asli |
| `scripts/authorize-drive.js` | Otorisasi OAuth Drive admin dari komputer sendiri |
| `tests/migration.test.js` | Pengujian lokal tanpa kredensial Google |
| `vercel.json` | Output publik dan fungsi API; tanpa rewrite catch-all |
| `.env.example` | Contoh nama konfigurasi server |

`lib`, `tests`, `.env`, dan scripts tidak berada dalam direktori publik.
Jangan memindahkan file rahasia ke `public`.

## 3. Cadangkan dan persiapkan Google Sheets

1. Buat salinan Spreadsheet kerja sebagai cadangan.
2. Tetap gunakan Spreadsheet lama, bukan membuat database kosong.
3. Pertahankan tab dan urutan header: Products, Users, Sessions, Orders,
   Categories, Packages, Previews, Media, Settings. Header lengkap ada di
   `lib/schema.js`. Jika tidak sesuai, API menolak menulis agar tidak salah kolom.
4. Ambil ID Spreadsheet dari bagian `/d/ID_SPREADSHEET/edit`.
   URL Apps Script `/exec` tidak mengungkap ID ini, sehingga masih perlu kamu isi.
5. Ambil ID folder media lama dari Drive atau Script Properties `DRIVE_FOLDER_ID`.
6. Jika ada akun lama dengan kolom password kosong dan passwordHash terisi,
   salin **AUTH_PEPPER yang sama persis** dari Apps Script > Project Settings >
   Script Properties. Tanpa nilai lama, hash lama tidak dapat diverifikasi.
   Akun yang sudah memakai password plain tetap kompatibel. Nilai password baru
   tetap mengikuti penyimpanan plain versi sumber; tidak pernah dikirim ke katalog.

Jangan mempublikasikan seluruh Spreadsheet sebagai CSV publik: file ini juga
berisi akun dan pesanan. Integrasi menggunakan API resmi dengan autentikasi server.

## 4. Pilih autentikasi Google

### A. Sheets dengan service account

1. Di Google Cloud Console, buat/pilih project lalu aktifkan Google Sheets API.
2. Buat service account di IAM & Admin > Service Accounts.
3. Buat key JSON. Simpan privat di komputer; jangan commit key JSON ke GitHub.
4. Share Spreadsheet kerja ke email `client_email` pada key JSON sebagai Editor.
   Editor diperlukan untuk checkout, sesi login, dan perubahan admin. Untuk hanya
   membaca katalog, Viewer cukup, tetapi seluruh fitur menulis tidak akan bekerja.
5. Isi environment Vercel dari `client_email` dan `private_key` sesuai bagian 5.

Untuk membaca gambar lama dengan service account, aktifkan Google Drive API dan
share folder/file media lama dengan akun tersebut. Pengunggahan baru ke shared
drive memerlukan izin menambahkan file dalam shared drive, bukan folder My Drive.

**Drive pribadi:** service account tidak memiliki kuota untuk menjadi pemilik
file baru. Sekadar share folder My Drive ke service account tidak menyelesaikan
kebutuhan unggah. Untuk mempertahankan Drive pribadi admin, gunakan opsi B.

### B. Pilihan untuk seluruh fitur dengan Drive pribadi admin: OAuth

Dengan opsi ini, server menggunakan OAuth admin untuk Sheets **dan** Drive.
Service-account email/private key boleh tidak diisi. Pengunjung tidak perlu login
Google; mereka tetap login memakai akun JASAhub.

1. Pada project Google Cloud yang sama, aktifkan Google Sheets API dan Drive API.
2. Konfigurasikan OAuth consent screen; jika Testing, tambahkan akun admin sebagai
   test user. Pilih scope Sheets dan Drive sebagaimana diminta helper.
3. Buat OAuth client bertipe **Web application**.
4. Tambahkan Authorized redirect URI **persis**:
   `http://localhost:53682/callback`.
5. Pada komputer sendiri, pasang Node.js 24. Salin `.env.example` menjadi `.env`.
6. Isi `GOOGLE_OAUTH_CLIENT_ID` dan `GOOGLE_OAUTH_CLIENT_SECRET` di `.env`.
7. Dari folder proyek jalankan:

   ```bash
   node --env-file=.env scripts/authorize-drive.js
   ```

8. Buka URL yang tercetak, pilih akun Google pemilik Spreadsheet dan folder media,
   lalu setujui akses. Helper menyimpan refresh token dalam `.env.oauth` lokal;
   token tidak dicetak ke terminal dan file ini dikecualikan oleh `.gitignore`.
9. Salin refresh token tersebut ke Vercel Environment Variables bersama client ID
   dan client secret. Isi `GOOGLE_SHEET_ID` dan `DRIVE_FOLDER_ID` yang lama.
10. Untuk produksi, periksa publishing status/ketentuan verifikasi OAuth Google.
    Aplikasi External berstatus Testing dengan scope ini menghasilkan refresh
    token yang kedaluwarsa dalam 7 hari. Jangan mengandalkan token Testing untuk
    operasi permanen; setelah mengubah status, otorisasi ulang jika diperlukan.

Jika `.env.oauth` sudah ada, helper menolak menimpanya. Pindahkan/hapus file lokal
tersebut secara sengaja sebelum membuat token baru. Jangan kirim token ke chat.

## 5. Buat proyek di Vercel

1. Ekstrak ZIP. Upload **isi folder JASAhub-Vercel** ke repository GitHub.
   GitHub hanya menjadi penyimpanan kode; GitHub Pages tidak perlu diaktifkan.
   Jangan upload folder pembungkus lain tanpa menyesuaikan Root Directory.
2. Vercel > Add New > Project > import repository tersebut.
3. Framework Preset: **Other**. Root Directory: folder yang memuat package.json,
   vercel.json, api, lib, dan public.
4. Build Command: kosong/tidak perlu. Output Directory: **public**.
   `vercel.json` sudah menetapkannya. Gunakan Node.js **24.x**.
5. Tambahkan variabel berikut pada Settings > Environment Variables:

   | Variabel | Isi |
   | --- | --- |
   | `GOOGLE_SHEET_ID` | ID Spreadsheet kerja lama |
   | `GOOGLE_SERVICE_ACCOUNT_EMAIL` | client_email; untuk mode A |
   | `GOOGLE_PRIVATE_KEY` | private_key; untuk mode A |
   | `AUTH_PEPPER` | nilai lama; diperlukan untuk akun hash lama saja |
   | `DRIVE_FOLDER_ID` | ID folder media lama |
   | `GOOGLE_OAUTH_CLIENT_ID` | untuk mode B |
   | `GOOGLE_OAUTH_CLIENT_SECRET` | untuk mode B |
   | `GOOGLE_OAUTH_REFRESH_TOKEN` | untuk mode B |

   Private key boleh berisi newline asli atau literal `\n`; server menangani
   keduanya. Jangan menambahkan kutip pembungkus ke nilai dalam dashboard Vercel.
   Semua variabel privat: jangan gunakan prefix `NEXT_PUBLIC_` atau `VITE_`.
   Isi juga untuk Preview jika ingin menguji preview deployment.
6. Deploy. Jika environment diubah sesudahnya, lakukan Redeploy.
7. Buka `/api/jasa`. Respons harus JSON `{ "ok": true, "data": ... }`.
8. Buka `/`, katalog, detail, modal, login, dashboard pelanggan dan admin.
   Coba di lebar 360px, 390px, dan desktop.

## 6. Cara kerja endpoint dan cache

Frontend tetap memanggil fungsi `api('catalog')` yang dipakai renderer asli.
Implementasi jaringan di `public/assets/jasahub.js` mengarah ke `/api/jasa`:

```js
const response = await fetch('/api/jasa', { credentials: 'omit' });
const result = await response.json();
if (!response.ok || !result.ok) throw new Error(result.error || 'Katalog gagal dimuat');
const katalog = result.data;
// Renderer asli menerima katalog.products, katalog.categories, katalog.settings.
```

Tidak ada penggantian innerHTML katalog dengan desain baru. Fungsi asli
refreshCatalog, renderProducts, card, dan thumb tetap menjadi renderer.

`api/jasa.js` membaca tabel publik dan merespons:

```js
res.setHeader('Cache-Control',
  'public, max-age=0, s-maxage=600, stale-while-revalidate=60');
```

Ini adalah **cache CDN Vercel**, bukan Map/memori proses Node.js. Respons katalog
segar dapat dipakai CDN selama 600 detik. Setelahnya CDN dapat melayani respons
lama selama 60 detik sambil memperbarui. Tidak ada jaminan semua request pertama
pada semua lokasi langsung menjadi cache hit.

Browser tetap mempunyai cache katalog 3 menit dari versi sebelumnya. Perubahan
langsung di Sheet tidak langsung muncul di setiap browser: cache CDN, periode
revalidasi, serta cache browser dapat menambah jeda. Admin mendapat data baru
melalui adminData tanpa cache setelah menyimpan, tetapi pengunjung mengikuti TTL.
Untuk perubahan publik mendesak, purge CDN cache melalui kontrol/CLI Vercel lalu
hapus cache browser JASAhub. Deploy baru juga mempunyai cache deployment sendiri.

Jangan menambahkan timestamp acak ke setiap fetch; itu membuat varian URL cache.
Jangan gunakan `cache: 'no-store'` atau request Authorization pada fetch katalog.
Kredensial Google hanya digunakan pada koneksi server-ke-Google.

Error/405/400 memakai `private, no-store`; data Users, Sessions, dan Orders tidak
pernah dimasukkan ke cache bersama. Endpoint katalog hanya menghitung jumlah
pesanan dari kolom productId/status, tanpa memuat kebutuhan dan identitas pembeli.
Checkout memeriksa ulang harga paket langsung dari Sheets sebelum menulis pesanan.
`/api/rpc` selalu tanpa cache, termasuk akun, pesanan, admin, dan unggahan.
`/api/media?id=...` mengembalikan byte gambar dengan cache tersendiri; file harus
terdaftar sebagai media publik. ID file baru dipakai setiap kali mengganti gambar.

## 7. Periksa cache dan jalur aset

Jalankan dari komputer sendiri setelah deployment:

```bash
curl -i https://NAMA-PROYEK.vercel.app/api/jasa
curl -i https://NAMA-PROYEK.vercel.app/api/jasa
curl -I https://NAMA-PROYEK.vercel.app/assets/jasahub.js
curl -I https://NAMA-PROYEK.vercel.app/assets/logo.png
```

Periksa `x-vercel-cache`: setelah cache terisi biasanya berubah dari MISS ke HIT;
STALE menunjukkan respons lama yang memenuhi aturan revalidasi. Vercel dapat
menghapus s-maxage/stale-while-revalidate dari header yang diterima browser, sehingga
lihat `x-vercel-cache`, bukan hanya teks Cache-Control yang terlihat di browser.
Pengaturan DevTools Disable cache/no-cache bisa mengubah perilaku pengujian.

Di Network, `/assets/jasahub.js` harus berstatus 200 dan berisi JavaScript,
bukan HTML. Tidak ada rewrite `/(.*) -> /index.html` yang menelan `/api` atau aset.
Alamat API dan aset diawali `/`, sehingga tidak mengikuti subpath halaman.

## 8. Cutover dari website lama

1. Uji deployment Preview memakai **salinan** Spreadsheet terlebih dahulu.
2. Periksa login admin lama, katalog, paket, galeri dan QRIS.
3. Coba satu pesanan: Belum Dibayar -> Proses Pengerjaan (verifikasi admin)
   -> Selesai. Pastikan baris tersimpan di Sheet yang benar.
4. Coba pelanggan kedua: ia tidak boleh melihat pesanan akun pertama.
5. Uji unggah thumbnail dan QRIS dengan OAuth/izin Drive yang benar.
6. Setelah siap, arahkan domain/pengunjung ke Vercel. Hentikan akses tulis website
   lama dan nonaktifkan deployment Apps Script lama agar tidak ada dua backend
   independen menulis Sheet yang sama. Simpan source lama sebagai cadangan.
7. Login sekali pada domain Vercel. Penyimpanan browser bersifat per-origin, jadi
   token dari domain GitHub Pages tidak dapat otomatis dipindahkan. Setelah login
   pada Vercel, token tetap tersimpan saat refresh selama sesi server 8 jam berlaku.

Tidak perlu menjalankan Setup.gs lagi. Paket ini tidak mengisi ulang sample data
atau mereset akun admin. Akun dan role menggunakan tabel Users yang sudah ada.

## 9. Penulisan bersamaan dan pemulihan

Untuk menyelaraskan operasi tulis antar instance Vercel tanpa layanan database
lain, backend membuat tab sementara tersembunyi `__JASAHUB_WRITE_LOCK`.
Tab itu memakai sheetId berbeda untuk setiap pemegang lock. Request tulis lain
menunggu singkat lalu mendapat pesan coba lagi jika masih sibuk. Setelah lock
didapat, data dibaca ulang dan perubahan disimpan melalui batchUpdate, bersamaan
dengan penghapusan tab lock. Katalog dan pembacaan dashboard tidak mengambil lock.

Penghapusan record mengosongkan baris, bukan menggeser baris lain. Ini menjaga
referensi posisi baris selama operasi. Jangan mengubah urutan header, menyortir
atau menghapus baris secara manual pada saat transaksi website berlangsung.
Edit isi katalog secara manual saat tidak ada penyimpanan admin berlangsung.

Jika function dihentikan paksa/timeout dan tab lock tertinggal: hentikan sementara
penulisan website, pastikan semua request lama telah selesai (setidaknya 2 menit
setelah request terakhir), lalu hapus **hanya** tab `__JASAHUB_WRITE_LOCK` melalui
Google Sheets. Aktifkan kembali website. Tidak ada penghapusan lock otomatis
berdasarkan waktu karena itu dapat membiarkan dua penulis berjalan bersamaan.
Mekanisme ini perlu diuji dengan Google nyata; pengujian lokal menggunakan simulasi.
Jika unggahan Drive berhasil tetapi penyimpanan Sheet gagal, file dapat tertinggal
di folder tanpa referensi. File tidak otomatis dihapus ketika hasil commit tidak
pasti, agar respons jaringan yang hilang tidak menghapus file yang sudah terdaftar.

Throttle percobaan login dalam kode hanya best-effort per instance. Aktifkan
aturan rate limit Vercel Firewall pada `/api/rpc` sesuai opsi plan yang tersedia.
Sheets tetap memiliki kuota dan bukan database transaksi untuk trafik besar;
cache katalog menurunkan pembacaan publik, bukan menghilangkan kuota operasi akun.

## 10. Validasi dan batas hasil

Jalankan `npm test` pada Node.js 24. Pengujian meliputi parsing script klasik,
jalur aset, katalog tanpa data pribadi, login, kedaluwarsa sesi, harga server,
idempotensi pada snapshot yang sama, izin admin, status pembayaran, isolasi
pesanan, penghapusan paket, validasi unggahan, serta header cache sukses/error.

Pengujian tidak menggunakan kredensial atau deployment Google/Vercel asli.
Uji visual browser, kuota, perilaku CDN nyata, izin Drive dan koordinasi lock
lintas instance harus diperiksa sesudah konfigurasi. Tidak ada janji semua request
selalu instan: request pertama tanpa cache tetap perlu menghubungi Google.

## Referensi resmi

- Vercel Node.js runtime: https://vercel.com/docs/functions/runtimes/node-js
- Vercel Cache-Control: https://vercel.com/docs/caching/cache-control-headers
- Vercel cache status: https://vercel.com/docs/headers/response-headers
- Sheets values.batchGet: https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets.values/batchGet
- Sheets batch atomic updates: https://developers.google.com/workspace/sheets/api/guides/batch
- Drive/service account: https://developers.google.com/workspace/drive/api/guides/folder
- Google OAuth: https://developers.google.com/identity/protocols/oauth2/web-server
- OAuth token expiration: https://developers.google.com/identity/protocols/oauth2
