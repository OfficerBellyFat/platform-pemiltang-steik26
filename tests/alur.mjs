/**
 * Uji alur ujung-ke-ujung: index -> PIN -> pilih -> suara -> rekap + panel panitia.
 *
 * Pakai:
 *   1) npm run dev                     (terminal lain, http://localhost:8787)
 *   2) npm run db:reset:local          (database lokal harus dalam keadaan bersih)
 *   3) npm test
 *
 * Kata sandi panitia dan PIN dibaca dari .dev.vars supaya tidak perlu
 * disalin ke berkas ini.
 *
 * Yang paling penting di sini adalah bagian 6: satu pembukaan PIN hanya boleh
 * menghasilkan satu suara, termasuk kalau halamannya dikirim ulang, dibuka di
 * dua tab, atau tombol back dipakai.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const AKAR = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = process.env.BASE_URL || 'http://localhost:8787';

function bacaDevVars() {
  const isi = readFileSync(join(AKAR, '.dev.vars'), 'utf8');
  const nilai = {};
  for (const baris of isi.split('\n')) {
    const pisah = baris.indexOf('=');
    if (pisah > 0) nilai[baris.slice(0, pisah).trim()] = baris.slice(pisah + 1).trim();
  }
  return nilai;
}

const devVars = bacaDevVars();
const ADMIN = process.env.ADMIN_PASSWORD || devVars.ADMIN_PASSWORD;
const PIN = process.env.VOTING_PIN || devVars.VOTING_PIN;
if (!ADMIN || !PIN) throw new Error('ADMIN_PASSWORD / VOTING_PIN tidak ditemukan di .dev.vars');

let gagal = 0;
function cek(nama, syarat, tambahan = '') {
  if (!syarat) gagal++;
  console.log(`${syarat ? 'OK  ' : 'GAGAL'} ${nama}${tambahan ? ` — ${tambahan}` : ''}`);
}

/** Cookie "Secure" tidak dikirim curl lewat http, jadi dikelola manual. */
class Klien {
  constructor(cookie) {
    this.cookie = cookie ? new Map(cookie) : new Map();
  }
  serap(res) {
    for (const raw of res.headers.getSetCookie()) {
      const [pasangan] = raw.split(';');
      const pisah = pasangan.indexOf('=');
      const k = pasangan.slice(0, pisah).trim();
      const v = pasangan.slice(pisah + 1).trim();
      if (v === '') this.cookie.delete(k);
      else this.cookie.set(k, v);
    }
  }
  async minta(path, { method = 'GET', form } = {}) {
    const headers = {};
    let body;
    if (this.cookie.size) headers.Cookie = [...this.cookie].map(([k, v]) => `${k}=${v}`).join('; ');
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(form).toString();
    }
    const res = await fetch(new URL(path, BASE), { method, headers, body, redirect: 'manual' });
    this.serap(res);
    return { status: res.status, lokasi: res.headers.get('Location'), isi: await res.text() };
  }
}

const tamu = new Klien();
const panitia = new Klien();
const pemilih = new Klien();
let r;

console.log('\n--- 1. Sebelum dibuka ---');
r = await tamu.minta('/');
cek('GET / = 200', r.status === 200);
cek('form login disembunyikan', !r.isi.includes('<form class="login-card"'));
cek('pesan "belum dibuka"', r.isi.includes('Pemilihan belum dibuka'));
cek('tombol Lihat Rekapitulasi ada', r.isi.includes('href="rekap.html"'));
cek('tidak ada cookie perangkat sama sekali', ![...tamu.cookie.keys()].some((k) => /did|device/i.test(k)), [...tamu.cookie.keys()].join(',') || 'kosong');

r = await tamu.minta('/rekap.html');
cek('rekap.html = 200', r.status === 200);
cek('rekap masih bertanda –', r.isi.includes('Hasil belum tersedia'));

r = await tamu.minta('/css/style.css');
cek('aset css tembus', r.status === 200 && r.isi.includes('--tally'));

r = await tamu.minta('/src/worker.js');
cek('berkas internal tidak disajikan', r.status === 404);

console.log('\n--- 2. Panel panitia ---');
r = await panitia.minta('/admin');
cek('GET /admin = form masuk', r.status === 200 && r.isi.includes('Kata sandi panitia'));

r = await panitia.minta('/admin.html');
cek('/admin.html dialihkan ke /admin', r.lokasi === `${BASE}/admin`, r.lokasi);

r = await panitia.minta('/admin/masuk', { method: 'POST', form: { sandi: 'salah' } });
cek('sandi salah ditolak', r.lokasi === `${BASE}/admin?e=sandi`, r.lokasi);

r = await panitia.minta('/admin/masuk', { method: 'POST', form: { sandi: ADMIN } });
cek('sandi benar diterima', r.lokasi === `${BASE}/admin`);
cek('cookie panitia ada', panitia.cookie.has('pemiltang_adm'));

r = await panitia.minta('/admin');
cek('panel tampil', r.isi.includes('Perolehan sementara'));
cek('penanda {{...}} habis diganti', !r.isi.includes('{{'));
cek('status awal belum dibuka', r.isi.includes('Belum dibuka'));
cek('bagian perangkat yang sudah memilih hilang', !r.isi.includes('Perangkat yang sudah memilih') && !r.isi.includes('device_id'));
cek('penghitung PIN mulai dari 0', r.isi.includes('membuka <strong>0</strong>'));

console.log('\n--- 3. Buka pemilihan ---');
r = await tamu.minta('/admin');
cek('tamu melihat form masuk, bukan panel', r.status === 200 && r.isi.includes('Kata sandi panitia'));

r = await tamu.minta('/admin/status', { method: 'POST', form: { state: 'tutup' } });
cek('tamu tidak bisa mengubah status', r.lokasi === `${BASE}/admin`, r.lokasi);

r = await tamu.minta('/admin/kosongkan', { method: 'POST', form: { konfirmasi: 'KOSONG' } });
cek('tamu tidak bisa mengosongkan kotak', r.lokasi === `${BASE}/admin`, r.lokasi);

r = await panitia.minta('/admin/status', { method: 'POST', form: { state: 'buka' } });
cek('status jadi buka', r.lokasi === `${BASE}/admin?ok=buka`, r.lokasi);

console.log('\n--- 4. Login pemilih ---');
r = await pemilih.minta('/');
cek('form punya name="pin"', r.isi.includes('id="pin" name="pin"'));
cek('form POST /sesi', r.isi.includes('action="/sesi" method="post"'));

r = await pemilih.minta('/sesi', { method: 'POST', form: { pin: '000000' } });
cek('PIN salah ditolak', r.lokasi === `${BASE}/?e=pin`, r.lokasi);
cek('cookie sesi tidak dipasang', !pemilih.cookie.has('pemiltang_sesi'));

r = await pemilih.minta('/sesi', { method: 'POST', form: { pin: PIN } });
cek('PIN benar -> pilih.html', r.lokasi === `${BASE}/pilih.html`, r.lokasi);
cek('cookie sesi dipasang', pemilih.cookie.has('pemiltang_sesi'));

r = await panitia.minta('/admin');
cek('penghitung PIN naik jadi 1', r.isi.includes('membuka <strong>1</strong>'));

console.log('\n--- 5. Kartu suara ---');
r = await pemilih.minta('/pilih.html');
cek('halaman pilih tampil', r.status === 200 && r.isi.includes('Choose your GENESIS'));
cek('dua tombol jadi form POST', (r.isi.match(/action="\/vote" method="post"/g) || []).length === 2);
cek('pilihan terkirim sebagai hidden input', r.isi.includes('value="muchsin-edo"'));

r = await new Klien().minta('/pilih.html');
cek('tanpa sesi PIN ditolak', r.lokasi === `${BASE}/?e=sesi`, r.lokasi);

r = await pemilih.minta('/vote', { method: 'POST', form: { pilihan: 'kandidat-palsu' } });
cek('pilihan tidak dikenal ditolak', r.lokasi === `${BASE}/pilih.html`, r.lokasi);

console.log('\n--- 6. Satu pembukaan = satu suara ---');
// Pilihan palsu di atas tidak boleh menghanguskan jatah pemilih.
r = await pemilih.minta('/pilih.html');
cek('jatah belum terpakai setelah kiriman cacat', r.status === 200 && r.isi.includes('Choose your GENESIS'));

// Simpan cookie sebelum memilih, untuk meniru dua tab / tombol back.
const sesiTersimpan = new Map(pemilih.cookie);

r = await pemilih.minta('/vote', { method: 'POST', form: { pilihan: 'cheryl-viby' } });
cek('suara diterima -> tercatat.html', r.lokasi === `${BASE}/tercatat.html`, r.lokasi);
cek('cookie sesi dibuang setelah memilih', !pemilih.cookie.has('pemiltang_sesi'));

const kembar = new Klien(sesiTersimpan);
r = await kembar.minta('/vote', { method: 'POST', form: { pilihan: 'muchsin-edo' } });
cek('kiriman ulang dari tab kedua ditolak', r.lokasi === `${BASE}/tercatat.html`, r.lokasi);

r = await kembar.minta('/pilih.html');
cek('tab kedua tidak bisa membuka kartu suara', r.lokasi === `${BASE}/tercatat.html`, r.lokasi);

r = await panitia.minta('/admin');
cek('kotak suara tetap berisi 1 suara', r.isi.includes('Total suara masuk: <strong>1</strong>'));
cek('suara kedua tidak masuk ke Muchsin Edo', r.isi.includes('<td>0 suara</td>'));

// Tombol back: kirim ulang POST /vote tanpa cookie sesi sama sekali.
r = await new Klien().minta('/vote', { method: 'POST', form: { pilihan: 'cheryl-viby' } });
cek('kiriman tanpa sesi ditolak', r.lokasi === `${BASE}/?e=sesi`, r.lokasi);

r = await tamu.minta('/rekap.html');
cek('rekap masih tertutup saat pemilihan buka', r.isi.includes('Hasil belum tersedia'));

console.log('\n--- 7. Tutup + rekapitulasi ---');
r = await panitia.minta('/admin');
cek('perolehan sementara terlihat panitia', r.isi.includes('Cheryl Viby') && r.isi.includes('100.00%'));

r = await panitia.minta('/admin/status', { method: 'POST', form: { state: 'tutup' } });
cek('status jadi tutup', r.lokasi === `${BASE}/admin?ok=tutup`, r.lokasi);

r = await tamu.minta('/rekap.html');
cek('rekap menampilkan 100.00%', r.isi.includes('100.00%'));
cek('rekap menampilkan 1 suara', r.isi.includes('1 suara'));
cek('rekap menampilkan 0.00%', r.isi.includes('0.00%'));

r = await tamu.minta('/pilih.html');
cek('pilih.html ditutup', r.lokasi === `${BASE}/?e=tutup`, r.lokasi);

console.log('\n--- 8. Ganti PIN ---');
r = await panitia.minta('/admin/pin', { method: 'POST', form: { pin: '135790' } });
cek('PIN baru dibuat', r.lokasi === `${BASE}/admin?pin=135790`, r.lokasi);

r = await panitia.minta('/admin');
cek('penghitung PIN direset oleh ganti PIN', r.isi.includes('membuka <strong>0</strong>'));

await panitia.minta('/admin/status', { method: 'POST', form: { state: 'buka' } });
const lain = new Klien();
r = await lain.minta('/sesi', { method: 'POST', form: { pin: PIN } });
cek('PIN lama tidak berlaku lagi', r.lokasi === `${BASE}/?e=pin`, r.lokasi);
r = await lain.minta('/sesi', { method: 'POST', form: { pin: '135790' } });
cek('PIN baru berlaku', r.lokasi === `${BASE}/pilih.html`, r.lokasi);

console.log('\n--- 9. Kosongkan kotak suara ---');
r = await panitia.minta('/admin/kosongkan');
cek('halaman konfirmasi tampil', r.status === 200 && r.isi.includes('Kosongkan kotak suara?'));
cek('konfirmasi menyebut jumlah suara', r.isi.includes('<strong>1 suara</strong>'));

r = await panitia.minta('/admin/kosongkan', { method: 'POST', form: { konfirmasi: 'salah' } });
cek('kata konfirmasi salah ditolak', r.lokasi === `${BASE}/admin/kosongkan`, r.lokasi);
r = await panitia.minta('/admin');
cek('kotak suara belum dikosongkan', r.isi.includes('Total suara masuk: <strong>1</strong>'));

r = await panitia.minta('/admin/kosongkan', { method: 'POST', form: { konfirmasi: 'kosong' } });
cek('kata konfirmasi benar diterima', r.lokasi === `${BASE}/admin?ok=kosong`, r.lokasi);

r = await panitia.minta('/admin');
cek('kotak suara kosong', r.isi.includes('Total suara masuk: <strong>0</strong>'));
cek('hitungan PIN ikut nol', r.isi.includes('membuka <strong>0</strong>'));
cek('status pemilihan tidak ikut berubah', r.isi.includes('Sedang dibuka'));

r = await lain.minta('/pilih.html');
cek('pembukaan yang masih hidup ikut ditutup', r.lokasi === `${BASE}/?e=sesi`, r.lokasi);

console.log(`\n${gagal === 0 ? 'SEMUA LULUS' : `${gagal} GAGAL`}`);

if (gagal > 0) {
  console.log('Jalankan `npm run db:reset:local` lalu `npm test` lagi dari database bersih.\n');
  process.exit(1);
}

// Kembalikan ke keadaan bersih supaya demo berikutnya tidak mewarisi sisa uji.
for (const [path, form] of [
  ['/admin/status', { state: 'belum' }],
  ['/admin/pin', { pin: PIN }],
  ['/admin/kosongkan', { konfirmasi: 'KOSONG' }],
]) {
  await panitia.minta(path, { method: 'POST', form });
}
console.log('Database lokal dikembalikan: status belum, PIN seperti di .dev.vars, kotak suara kosong.\n');
