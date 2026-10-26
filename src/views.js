/* ==========================================================================
   Pemilihan GENESIS STEI-K '26 — penulis ulang tampilan
   Berkas HTML di root repo ini tetap menjadi sumber tampilan. Worker
   mengambil isinya lewat binding ASSETS, lalu fungsi di sini menukar bagian
   yang tadinya mati (form tanpa action, tombol "Saya yakin" tanpa
   pengiriman, angka rekap bertanda "–") dengan versi yang benar-benar
   mengirim/menampilkan data.
   ========================================================================== */

import { KANDIDAT, STATUS, aman, formatPersen, formatWaktu, labelStatus } from './lib.js';

const POLA_FORM_LOGIN = /<form class="login-card"[\s\S]*?<\/form>/;
const LABEL_KANDIDAT = {
  'cheryl-viby': 'Cheryl Viby',
  'muchsin-edo': 'Muchsin Edo',
};

/* ------------------------------ index.html ------------------------------- */

/**
 * @param {string} html isi index.html asli
 * @param {{state:string, error:?string}} opsi
 */
export function viewLogin(html, { state, error }) {
  let out = html;

  if (state !== STATUS.BUKA) {
    const pesan =
      state === STATUS.TUTUP
        ? 'Pemilihan sudah ditutup. Hasil dapat dilihat di halaman rekapitulasi.'
        : 'Pemilihan belum dibuka. Silakan menunggu arahan panitia di lokasi.';
    const kartu = `<div class="login-card login-note">
      <p class="notice">${aman(pesan)}</p>
    </div>`;
    return out.replace(POLA_FORM_LOGIN, () => kartu);
  }

  // Form dikirim ke Worker, bukan lagi lompat ke pilih.html.
  out = out.replace('action="pilih.html" method="get"', 'action="/sesi" method="post"');
  // Input PIN tadinya tanpa name, jadi tidak ada yang terkirim.
  out = out.replace('<input id="pin" type="password"', '<input id="pin" name="pin" type="password"');

  if (error) {
    out = out.replace(
      '<input id="pin" name="pin"',
      () => `<p class="login-err" role="alert">${aman(error)}</p>\n      <input id="pin" name="pin"`,
    );
  }

  // Tombol "Lihat Rekapitulasi" sudah ada di index.html sebagai penanda
  // statis, jadi tidak perlu disisipkan di sini.

  return out;
}

/* ------------------------------ pilih.html ------------------------------- */

/** Tombol "Saya yakin" jadi form POST yang benar-benar mengirim pilihan. */
export function viewPilih(html) {
  let out = html;
  for (const slug of KANDIDAT) {
    const pola = new RegExp(
      `(<div class="modal" id="konfirmasi-${slug}"[\\s\\S]*?)<a class="btn btn-light" href="tercatat.html">Saya yakin</a>`,
    );
    out = out.replace(
      pola,
      (_m, kepala) =>
        `${kepala}<form class="form-vote" action="/vote" method="post">` +
        `<input type="hidden" name="pilihan" value="${slug}">` +
        `<button class="btn btn-light" type="submit">Saya yakin</button></form>`,
    );
  }
  return out;
}

/* ------------------------------ rekap.html ------------------------------- */

/**
 * @param {string} html isi rekap.html asli
 * @param {?Record<string, number>} hasil null = sembunyikan hasil (tanda "–")
 */
export function viewRekap(html, hasil) {
  if (!hasil) return html;
  const total = Object.values(hasil).reduce((a, b) => a + b, 0);
  // Satu lintasan dengan /g: kalau penggantian dilakukan satu per satu,
  // blok yang baru disisipkan bisa ketemu lagi oleh pencarian berikutnya.
  let urutan = 0;
  return html.replace(/<div class="tally">[\s\S]*?<\/div>/g, () => {
    const slug = KANDIDAT[urutan++];
    if (!slug) return '<div class="tally"></div>';
    const jumlah = hasil[slug] || 0;
    return (
      `<div class="tally">\n` +
      `          <strong>${formatPersen(jumlah, total)}</strong>\n` +
      `          <span>${jumlah} suara</span>\n` +
      `        </div>`
    );
  });
}

/* ------------------------------- admin ----------------------------------- */

/** Isi <main> untuk admin.html, dengan {{ISI}} sebagai penanda. */
export function viewAdminLogin({ pesan }) {
  return `<form class="login-card admin-masuk" action="/admin/masuk" method="post">
      ${pesan ? `<p class="login-err" role="alert">${aman(pesan)}</p>` : ''}
      <label class="sr-only" for="sandi">Kata sandi panitia</label>
      <input id="sandi" name="sandi" type="password" autocomplete="current-password" required placeholder="Kata sandi panitia">
      <button type="submit" class="btn btn-dark">Masuk <img src="assets/icons/arrow-right.svg" alt="" width="18" height="18"></button>
    </form>`;
}

export function viewAdminPanel({ state, hasil, total, pinDiubah, pinTerbuka, pesan, pinBaru }) {
  const barisHasil = KANDIDAT.map((slug) => {
    const n = hasil[slug] || 0;
    return `<tr>
          <th scope="row">${aman(LABEL_KANDIDAT[slug] || slug)}</th>
          <td>${n} suara</td>
          <td>${formatPersen(n, total)}</td>
        </tr>`;
  }).join('\n        ');

  const tombolStatus =
    state === STATUS.BUKA
      ? `<form action="/admin/status" method="post">
      <input type="hidden" name="state" value="${STATUS.TUTUP}">
      <button type="submit" class="btn btn-dark">Tutup pemilihan</button>
    </form>`
      : `<form action="/admin/status" method="post">
      <input type="hidden" name="state" value="${STATUS.BUKA}">
      <button type="submit" class="btn btn-dark">${state === STATUS.TUTUP ? 'Buka kembali' : 'Buka pemilihan'}</button>
    </form>`;

  // Semakin banyak pembukaan, semakin besar kemungkinan PIN terlihat orang
  // lain di antrean. Ini pengingat, bukan larangan.
  const saranGanti =
    pinTerbuka >= 25
      ? `<p class="notice pin-baru">PIN ini sudah membuka <strong>${pinTerbuka}</strong> kali. Sebaiknya diganti sekarang.</p>`
      : '';

  return `<div class="admin-grid">
      <section class="admin-card">
        <h2>Status</h2>
        <p class="stat"><span class="pill pill-${state}">${labelStatus(state)}</span></p>
        <p class="muted">Total suara masuk: <strong>${total}</strong></p>
        <div class="admin-aksi">
          ${tombolStatus}
          <a class="btn btn-light" href="rekap.html">Lihat rekapitulasi</a>
          <form action="/admin/keluar" method="post">
            <button type="submit" class="btn btn-light">Keluar</button>
          </form>
        </div>
        ${pesan ? `<p class="notice">${aman(pesan)}</p>` : ''}
      </section>

      <section class="admin-card">
        <h2>Perolehan sementara</h2>
        <p class="muted">Hanya terlihat di panel ini. rekap.html tetap bertanda “–” sampai pemilihan ditutup.</p>
        <table class="admin-tabel">
          <thead>
            <tr><th scope="col">Kandidat</th><th scope="col">Suara</th><th scope="col">Persentase</th></tr>
          </thead>
          <tbody>
            ${barisHasil}
          </tbody>
        </table>
      </section>

      <section class="admin-card">
        <h2>PIN petugas</h2>
        <p class="muted">PIN ini sudah membuka <strong>${pinTerbuka}</strong> kartu suara sejak terakhir diganti (${formatWaktu(pinDiubah)}).</p>
        <p class="muted">Karena tidak ada penguncian perangkat, PIN adalah satu-satunya kunci. Ganti berkala — terutama kalau antrean panjang — supaya orang yang sempat melihatnya tidak bisa memakai PIN itu lagi.</p>
        ${saranGanti}
        ${pinBaru ? `<p class="notice pin-baru">PIN baru: <strong class="mono">${aman(pinBaru)}</strong><br><span class="muted">Catat sekarang — nilai ini tidak ditampilkan lagi.</span></p>` : ''}
        <form action="/admin/pin" method="post" class="admin-form">
          <label for="pin">PIN 6 digit baru</label>
          <input id="pin" name="pin" inputmode="numeric" maxlength="6" pattern="[0-9]{6}" placeholder="Kosongkan untuk diacak">
          <button type="submit" class="btn btn-dark">Ganti PIN</button>
        </form>
      </section>

      <section class="admin-card admin-bahaya">
        <h2>Kotak suara</h2>
        <p class="muted">Menghapus seluruh suara yang sudah masuk, menutup semua pembukaan yang masih hidup, dan mengembalikan hitungan PIN ke nol. Pakai untuk membuang data latihan sebelum pemilihan sesungguhnya.</p>
        <div class="admin-aksi">
          <a class="btn btn-light" href="/admin/kosongkan">Kosongkan kotak suara</a>
        </div>
      </section>
    </div>`;
}

/** Halaman konfirmasi sebelum kotak suara dikosongkan. */
export function viewAdminKosongkan({ total, pinTerbuka }) {
  return `<div class="admin-grid">
      <section class="admin-card admin-bahaya admin-lebar">
        <h2>Kosongkan kotak suara?</h2>
        <p class="muted">Ini akan menghapus <strong>${total} suara</strong> yang sudah tercatat, membatalkan semua pembukaan PIN yang masih hidup, dan mengembalikan hitungan PIN (sekarang ${pinTerbuka}) ke nol. <strong>Tidak bisa dibatalkan.</strong></p>
        <p class="muted">Kalau ini bukan yang Anda maksud, kembali saja — tidak ada yang berubah.</p>
        <form action="/admin/kosongkan" method="post" class="admin-form">
          <label for="konfirmasi">Ketik <strong>KOSONG</strong> untuk memastikan</label>
          <input id="konfirmasi" name="konfirmasi" autocomplete="off" autocapitalize="characters" required placeholder="KOSONG">
          <button type="submit" class="btn btn-dark">Kosongkan</button>
          <a class="btn btn-light" href="/admin">Batal</a>
        </form>
      </section>
    </div>`;
}
