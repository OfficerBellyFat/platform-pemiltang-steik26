# Platform Pemilihan GENESIS STEI-K '26

Aplikasi pemilihan untuk GENESIS STEI-K '26, dari desain Figma "Web-pemiltang".
Tampilan tetap HTML + CSS tulisan tangan (tanpa framework, tanpa build step);
cerita di balik layar ada di dalam satu Cloudflare Worker dengan basis data D1.

## Halaman

| Urutan | File | Isi |
| --- | --- | --- |
| 1 | `index.html` | Login dengan PIN 6 digit dari petugas, plus tombol "Lihat Rekapitulasi" |
| 2 | `pilih.html` | "Choose your GENESIS!" + pop-up konfirmasi |
| 3 | `tercatat.html` | "Suara anda tercatat!" |
| 4 | `rekap.html` | Rekapitulasi suara — bertanda "–" sampai pemilihan ditutup |
| — | `admin.html` | Panel panitia: buka/tutup pemilihan, ganti PIN, kosongkan kotak suara |

Halaman-halaman itu **tidak berubah** saat berjalan. Worker mengambil isinya
lewat binding `ASSETS`, lalu `src/views.js` hanya menukar bagian yang tadinya
mati: form login diberi `name="pin"` dan diarahkan ke `POST /sesi`, tombol
"Saya yakin" jadi form `POST /vote`, dan angka `.tally` di `rekap.html` diisi
hasil sebenarnya. Karena itu `python3 -m http.server` tetap bisa dipakai untuk
melihat tampilan statisnya.

JavaScript di sisi pengunjung: **tidak ada sama sekali.** Pengiriman suara
memakai form POST biasa dan pengalihan halaman biasa (post/redirect/get).

## Alur

Pemungutan suara berlangsung di lokasi, di beberapa laptop panitia — seperti
bilik suara, tetapi digital. Yang menjaga satu-orang-satu-suara adalah petugas
di depan layar, bukan sistem.

1. Panitia membuka `/admin` lalu menekan **Buka pemilihan**. Sebelum itu
   halaman login menampilkan "Pemilihan belum dibuka".
2. Laptop berhenti di `index.html`. Petugas mengetik PIN 6 digit untuk pemilih
   yang sedang berdiri di depannya; `POST /sesi` memverifikasi PIN di server.
3. Pemilih memilih kartu, menekan "Saya yakin" di pop-up. `POST /vote`
   mencatat satu baris di tabel `ballots`.
4. **Satu ketikan PIN = satu suara.** Begitu suara masuk, cookie sesi dibuang
   dan laptop kembali ke halaman PIN untuk orang berikutnya.
5. Panitia menekan **Tutup pemilihan**. Sejak itu `rekap.html` menampilkan
   persentase dan jumlah suara; sebelum itu tetap bertanda "–".

## Model data (dan apa yang tidak disimpan)

| Tabel | Isi |
| --- | --- |
| `settings` | `state` (`belum`/`buka`/`tutup`), `pin_hash`, `pin_diubah`, `pin_terbuka` |
| `candidates` | slug + nama kandidat |
| `ballots` | `id`, `pilihan`, `created_at` — **tanpa** identitas pemilih |
| `sessions` | `nonce`, `dibuat`, `dipakai` — pembukaan PIN sekali pakai |
| `attempts` | penghitung percobaan per IP (anti brute-force) |

Tidak ada NIM, nama, nomor ponsel, atau id perangkat di mana pun. `ballots`
adalah satu-satunya catatan pemilihan, dan tidak ada tabel kedua yang bisa
di-join dengannya untuk menebak siapa memilih apa. Ini sengaja: sesuai
keputusan, keabsahan satu-orang-satu-suara dijaga petugas di lokasi.

`sessions` adalah pengganti penguncian perangkat. Setiap login menulis satu
baris, dan `/vote` mengklaim baris itu lewat `UPDATE ... WHERE dipakai = 0`.
Kalau tidak ada baris yang berubah, berarti pembukaan itu sudah menghasilkan
suara — entah tombol ditekan dua kali, dua tab dibuka bersamaan, atau halaman
dikirim ulang lewat tombol back. Suara kedua tidak pernah tercatat. Barisnya
dibuang otomatis setelah sehari dan tidak menyimpan siapa pun.

Karena tidak ada penguncian perangkat, **PIN adalah satu-satunya kunci**.
Yang membatasi penyalahgunaan: PIN hanya dibandingkan di server, `pin_terbuka`
di panel menghitung sudah berapa kartu suara dibuka oleh PIN yang sedang
berlaku (supaya tahu kapan harus diganti), ada batas percobaan per IP, dan ada
`BATAS_SUARA` di `src/lib.js` sebagai pagar terakhir.

## Menjalankan secara lokal

```bash
npm install
cp .dev.vars.example .dev.vars     # isi ADMIN_PASSWORD, SESSION_SECRET, VOTING_PIN
npm run db:migrate:local
npm run dev                        # http://localhost:8787
```

`npm run db:reset:local` mengosongkan database lokal dan mengulang migrasi.

Ada uji alur ujung-ke-ujung (63 pemeriksaan: login, satu-pembukaan-satu-suara
termasuk kiriman ulang dan dua tab, hasil yang belum tampil, panel panitia,
ganti PIN, kosongkan kotak suara):

```bash
npm run db:reset:local   # uji ini mengubah data, mulai dari bersih
npm test                 # butuh `npm run dev` berjalan di terminal lain
```

## Menerbitkan

```bash
npx wrangler login
npx wrangler d1 create pemiltang            # salin database_id ke wrangler.jsonc
npm run db:migrate                          # terapkan skema ke D1 produksi
npx wrangler secret put ADMIN_PASSWORD      # sandi panel panitia
npx wrangler secret put SESSION_SECRET      # openssl rand -hex 32
npx wrangler secret put VOTING_PIN          # PIN awal; bisa diganti dari panel
npm run deploy
```

Hasilnya berjalan di `https://platform-pemiltang-steik26.<subdomain>.workers.dev`.

### Pengerasan opsional untuk `/admin`

Panel panitia sudah dilindungi sandi, tetapi bisa juga dikunci di lapisan
Cloudflare supaya `/admin` tidak bisa diakses dari internet sama sekali:
Cloudflare Zero Trust → Access → Applications → Self-hosted, path
`platform-pemiltang-steik26.<subdomain>.workers.dev/admin*`, policy
"emails = daftar email panitia". Gratis sampai 50 pengguna.

## Catatan operasional

- **Ganti PIN tiap blok.** Ini satu-satunya hal yang benar-benar menahan
  pengisian suara dari luar lokasi, karena PIN bersifat bersama dan tidak ada
  penguncian perangkat. Panel menunjukkan sudah berapa kartu suara dibuka oleh
  PIN yang berlaku dan menyarankan ganti setelah 25 — angka itu bisa
  diturunkan dengan mengubah ambang di `src/views.js` kalau antreannya ramai.
- **Satu pemilih, satu ketikan PIN.** Jangan biarkan laptop tetap terbuka
  untuk beberapa orang sekaligus: jatah pemilih berikutnya sebenarnya sudah
  diberikan kepada orang sebelumnya (satu pembukaan = satu suara), jadi orang
  yang memegang laptop itu bisa memakainya.
- **Kosongkan kotak suara** sebelum pemilihan sesungguhnya untuk membuang
  data latihan. Hapus dua langkah: `/admin/kosongkan` lalu mengetik `KOSONG`.
  Ini menghapus semua `ballots`, menutup semua `sessions` yang masih hidup,
  dan mengosongkan hitungan PIN. **Ganti PIN juga** setelahnya.
- **Hasil tidak pernah tampil selama pemilihan berjalan**, hanya di `/admin`.
- **`SESSION_SECRET` mengikat `pin_hash`.** Menggantinya membuat PIN lama
  tidak berlaku lagi — setelah itu setel PIN baru dari panel.
- `ballots` hanya punya `created_at`. Siapa pun yang bisa melihat catatan
  urutan orang datang (misalnya petugas yang mengingat siapa memilih kapan)
  bisa membandingkannya dengan cap waktu itu. Ini konsekuensi dari model
  terpercaya-petugas: yang dijaga sistem adalah *apa* yang dipilih, bukan
  anonimitas penuh atas *kapan* seseorang memilih.
- Halaman diberi `noindex`.

## Struktur

```
index.html pilih.html tercatat.html rekap.html admin.html    tampilan (sumber asli)
css/style.css                                                gaya + tambahan panel
assets/ fonts/                                               gambar dan font lokal
src/worker.js                                                router + aturan bisnis
src/views.js                                                 penyisip data ke HTML
src/lib.js                                                   kripto, cookie, D1, format
tests/alur.mjs                                               uji alur ujung-ke-ujung
migrations/0001_init.sql                                     skema awal
wrangler.jsonc package.json .assetsignore                    konfigurasi
```

## Yang belum ada tujuannya

Link "Home" di header (`href="#"`), "Panitia" dan link footer (Accessibility,
Privacy, Need help?) masih teks biasa karena desain Figma belum punya
tujuannya. Isi kalau sudah ada alamatnya.
