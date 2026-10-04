# Ürün Kataloğu

Stok listesinden üretilen, giriş korumalı ürün kataloğu: kategoriler, ürün detayı, liste (sepet),
indirimli ve kalem bazında KDV'li proforma fatura, ürün ekleme / düzenleme / silme, kategori ekleme.

- **Önyüz:** `katalog/` (düz HTML + JS, derleme yok) — Vercel bu klasörü yayınlar (`vercel.json`).
- **Veri:** Supabase (Postgres + Auth + Storage). Ürünler, kategoriler ve fotoğraflar orada durur;
  hangi cihazdan girilirse girilsin aynı veri görünür.
- **Bu depoda fiyat / tedarikçi verisi yoktur.** Excel, `katalog.db`, görseller ve `.env` `.gitignore` ile dışarıda tutulur.

## Kurulum (bir kez)

1. Supabase'de proje açın. **SQL Editor**'de `supabase/kurulum.sql` dosyasının tamamını çalıştırın.
2. `katalog/config.js` içine proje adresini (`url`) ve herkese açık anahtarı (`anahtar`, anon / publishable) yazın.
3. `.env.ornek` dosyasını `.env` adıyla kopyalayıp doldurun (gizli `service_role` anahtarı, kullanıcı adı, şifre).
4. Excel'i veritabanına aktarın:
   ```
   pip install openpyxl pillow
   python veritabani_olustur.py     # Excel -> katalog.db + katalog/img
   python supabase_aktar.py         # katalog.db + görseller -> Supabase, giriş kullanıcısını oluşturur
   ```
5. Vercel'de bu depoyu içe aktarın (ayar gerekmez) ve yayınlayın.

`supabase_aktar.py` tekrar çalıştırılabilir: Supabase'de zaten bulunan ürünlere dokunmaz,
yalnızca eksikleri ekler. Şifreyi değiştirmek için `.env` içindeki `SIFRE`'yi değiştirip yeniden çalıştırın.

## Notlar

- Liste (sepet), proforma taslağı ve satıcı firma bilgileri cihazın tarayıcısında tutulur.
- Silinen ürünler kalıcı silinmez; Yönetim > Silinen ürünler'den geri alınabilir.
- Ürün fotoğrafları herkese açık bir depoda durur (adresini bilen görebilir); fiyat ve tedarikçi bilgisi yalnızca girişle okunur.
