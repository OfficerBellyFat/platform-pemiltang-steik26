# Platform Pemilihan GENESIS STEI-K '26 — kerangka

Kerangka tampilan (HTML + CSS saja) untuk pemilihan GENESIS, dari desain Figma "Web-pemiltang". **Tidak ada JavaScript, backend, atau autentikasi di sini**; itu dikerjakan terpisah (lihat `TODO(backend)` di tiap halaman).

## Halaman

| Urutan | File | Isi |
| --- | --- | --- |
| 1 | `index.html` | Login dengan PIN 6 digit |
| 2 | `pilih.html` | "Choose your GENESIS!" + pop-up konfirmasi |
| 3 | `tercatat.html` | "Suara anda tercatat!" |
| 4 | `rekap.html` | Rekapitulasi suara (tidak ada di PDF alur, hanya di Figma) |

Semua gaya ada di `css/style.css` (token warna/font di `:root`). Font (Poppins, Inter) di-host sendiri di `fonts/`; gambar sudah dioptimalkan ke WebP di `assets/img/`.

## Melihatnya secara lokal

```bash
python3 -m http.server 8000
```

Lalu buka http://localhost:8000.

## Yang masih kerangka (perlu diisi backend)

- **Login** (`index.html`): form hanya pindah ke `pilih.html`. Input PIN belum punya `name`, jadi tidak ada yang terkirim. Tambahkan `name="pin"`, `action` dan `method` ke endpoint login.
- **Konfirmasi** (`pilih.html`): pop-up dibuka lewat `:target` (`#konfirmasi-…`) tanpa JS. "Saya yakin" sekarang hanya link ke `tercatat.html`; ganti dengan pengiriman pilihan ke server.
- **Rekap** (`rekap.html`): persentase dan jumlah suara masih tanda strip. Angka "50.00% / 120 suara" di Figma hanya contoh.
- Link "Home" di header (`href="#"`) belum diarahkan ke situs utama. "Panitia" dan link footer (Accessibility, Privacy, Need help?) masih teks biasa karena desain belum punya tujuan.
- Halaman diberi `noindex`.
