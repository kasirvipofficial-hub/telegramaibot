# 📖 Video Engine Feature Reference Guide

Dokumen ini merangkum semua fitur, gaya, dan konfigurasi yang tersedia di Video Engine saat ini.

## 1. 📝 Gaya Teks (Text Styles)
Gunakan di: `composition.template_overrides.text_style` atau di payload `subtitles`. 

| Nama Gaya | Font | Karakteristik |
| :--- | :--- | :--- |
| `basic` | Arial | Standar dan bersih. |
| `impact_heavy` | Impact | Bold, kuning, outline tebal (cocok untuk sports/vlog). |
| `cinematic` | Times New Roman | Italic, elegan, abu-abu lembut. |
| `gothic` | UnifrakturMaguntia | Gaya klasik/kuno. |
| `oswald_bold` | Oswald | Modern tinggi, warna lavender, outline biru tua. |
| `modern_serif` | DM Serif Text | Elegan bermartabat, warna putih, outline coklat. |

## 2. ✨ Animasi Teks (Text Animations)
Gunakan di: `composition.template_overrides.animation`.

- `slide_up`: Muncul halus dengan fade in.
- `slide_up_bounce`: Memantul masuk dari bawah.
- `zoom_in`: Efek pop atau zoom membesar.
- `flash`: Efek flash cahaya saat berganti teks.

## 3. 🎬 Transisi (Transitions)
Gunakan di: `clip.transition.type`.

- **Fade**: `fade`, `fadeblack`, `fadewhite`.
- **Slide**: `slideleft`, `slideright`, `slideup`, `slidedown`.
- **Wipe**: `wipeleft`, `wiperight`, `wipeup`, `wipedown`.
- **Advanced**: `dissolve`, `pixelize`, `radial`, `hblur`, `smoothleft`.

## 4. 🖼️ Efek Gambar (Ken Burns)
Gunakan di: `clip.effect` (untuk input tipe image).

- `ken_burns_zoom_in`: Zoom masuk perlahan.
- `ken_burns_zoom_out`: Zoom keluar perlahan.
- `ken_burns_pan_right`: Bergeser ke arah kanan.
- `ken_burns_pan_left`: Bergeser ke arah kiri.

## 5. 🎨 Filter Warna (LUTs/Color Grading)
Gunakan di: `template.color_grade`.

- `AmberLight`: Memberikan nuansa hangat (warm/golden).
- `Filmmaker`: Nuansa sinematik profesional yang clean.

## 6. 📱 Orientasi & Resolusi
Gunakan di: `composition.output_format`.

- `shorts` / `reels` / `tiktok`: 1080x1920 (9:16)
- `landscape` / `youtube`: 1920x1080 (16:9)
- `square` / `instagram`: 1080x1080 (1:1)
- `portrait_4_5`: 1080x1350 (4:5)

## 7. 🎭 Template Bawaan
Gunakan di: `composition.template_id`.

- `aesthetic_vlog`: Kalem, sinematik, minimalis.
- `islamic_dakwah`: Desain religius formal.
- `motivational`: Dramatis dengan teks yang kuat.
- `news_breaking`: Gaya berita cepat.
- `news_headline`: Desain berita formal.
- `product_showcase`: Fokus pada visual produk.
- `shorts_modern_v1`: Standar konten vertikal modern.

---
*Tips: Anda dapat menimpa (override) pengaturan template apa pun melalui properti `template_overrides` di payload permintaan.*
