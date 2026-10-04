# -*- coding: utf-8 -*-
"""
Yerel katalog.db + katalog/img içeriğini Supabase'e aktarır ve giriş kullanıcısını oluşturur.

Önce:  1) supabase/kurulum.sql Supabase SQL Editor'de çalıştırılmış olmalı
       2) bu klasörde .env dosyası olmalı (.env.ornek dosyasına bakın)
       3) python veritabani_olustur.py   (katalog.db ve görselleri üretir)
Sonra: python supabase_aktar.py

Tekrar çalıştırmak güvenlidir: Supabase'de zaten olan ürün ve kategorilere dokunmaz
(sitede yapılan düzenlemeler ezilmez), yalnızca eksikleri ekler.
"""
import json
import os
import re
import sqlite3
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(ROOT, "katalog.db")
IMG = os.path.join(ROOT, "katalog", "img")
GIRIS_ALANI = "gokhanabi-katalog.com"      # app.js'deki epostaYap ile aynı olmalı


def env():
    p = os.path.join(ROOT, ".env")
    if not os.path.exists(p):
        sys.exit(".env dosyası yok (.env.ornek dosyasını kopyalayıp doldurun)")
    out = {}
    for line in open(p, encoding="utf-8-sig"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_KEY", "KULLANICI", "SIFRE"):
        if not out.get(k):
            sys.exit(".env içinde %s eksik" % k)
    out["SUPABASE_URL"] = out["SUPABASE_URL"].rstrip("/")
    return out


E = None


def istek(method, path, body=None, headers=None, raw=False):
    h = {"apikey": E["SUPABASE_SERVICE_KEY"], "Authorization": "Bearer " + E["SUPABASE_SERVICE_KEY"]}
    data = body
    if body is not None and not raw:
        data = json.dumps(body).encode("utf-8")
        h["Content-Type"] = "application/json"
    h.update(headers or {})
    req = urllib.request.Request(E["SUPABASE_URL"] + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            t = r.read().decode("utf-8")
            return r.status, (json.loads(t) if t else None)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace")


def ekle(tablo, satirlar, cakisma):
    """Toplu ekleme; var olan satırlara dokunmaz."""
    for i in range(0, len(satirlar), 500):
        st, out = istek("POST", "/rest/v1/%s?on_conflict=%s" % (tablo, cakisma), satirlar[i:i + 500],
                        {"Prefer": "resolution=ignore-duplicates,return=minimal"})
        if st >= 300:
            sys.exit("%s yazılamadı (%s): %s" % (tablo, st, out))


def gorsel_yukle(yol):
    boy, fn = yol
    with open(os.path.join(IMG, boy, fn), "rb") as f:
        raw = f.read()
    for _ in range(3):
        st, out = istek("POST", "/storage/v1/object/urunler/%s/%s" % (boy, fn), raw,
                        {"Content-Type": "image/webp", "Cache-Control": "max-age=31536000", "x-upsert": "true"}, raw=True)
        if st < 300:
            return None
    return "%s/%s: %s %s" % (boy, fn, st, out)


def depodakiler(boy):
    var, off = set(), 0
    while True:
        st, out = istek("POST", "/storage/v1/object/list/urunler", {"prefix": boy + "/", "limit": 1000, "offset": off})
        if st >= 300:
            sys.exit("Depo okunamadı (%s): %s\nsupabase/kurulum.sql çalıştırıldı mı?" % (st, out))
        var.update(o["name"] for o in out)
        if len(out) < 1000:
            return var
        off += 1000


def kullanici_olustur():
    eposta = E["KULLANICI"].strip()
    if "@" not in eposta:
        tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosucgiosu")
        eposta = re.sub(r"[^a-z0-9._-]", "", eposta.translate(tr).lower()) + "@" + GIRIS_ALANI
    st, out = istek("POST", "/auth/v1/admin/users",
                    {"email": eposta, "password": E["SIFRE"], "email_confirm": True})
    if st < 300:
        print("Kullanıcı oluşturuldu:", E["KULLANICI"])
        return
    # zaten varsa şifresini güncelle
    st2, liste = istek("GET", "/auth/v1/admin/users?per_page=1000")
    for u in (liste or {}).get("users", []) if st2 < 300 else []:
        if u.get("email") == eposta:
            st3, out3 = istek("PUT", "/auth/v1/admin/users/" + u["id"], {"password": E["SIFRE"]})
            if st3 < 300:
                print("Kullanıcı zaten vardı, şifresi güncellendi:", E["KULLANICI"])
                return
            sys.exit("Şifre güncellenemedi (%s): %s" % (st3, out3))
    sys.exit("Kullanıcı oluşturulamadı (%s): %s" % (st, out))


def main():
    global E
    E = env()
    if not os.path.exists(DB):
        sys.exit("katalog.db yok; önce: python veritabani_olustur.py")
    con = sqlite3.connect(DB)

    kats = con.execute("SELECT id, ad, slug, sira FROM kategoriler ORDER BY sira").fetchall()
    kslug = {k[0]: k[2] for k in kats}
    alts = con.execute("SELECT id, kategori_id, ad, slug FROM alt_kategoriler ORDER BY id").fetchall()
    aslug = {a[0]: a[3] for a in alts}
    ekle("kategoriler", [{"slug": k[2], "ad": k[1], "sira": k[3]} for k in kats], "slug")
    ekle("alt_kategoriler", [{"kat": kslug[a[1]], "slug": a[3], "ad": a[2], "sira": i}
                             for i, a in enumerate(alts, 1)], "kat,slug")
    print("Kategoriler: %d ana, %d alt" % (len(kats), len(alts)))

    gorsel = {}
    for uid, fn in con.execute("SELECT urun_id, dosya FROM urun_gorselleri ORDER BY urun_id, sira"):
        gorsel.setdefault(uid, []).append(fn)
    dosyalar = sorted({fn for v in gorsel.values() for fn in v})
    eksik = [(boy, fn) for boy in ("k", "b") for fn in dosyalar if fn not in depodakiler_cache(boy)]
    print("Görsel: %d dosya, yüklenecek: %d" % (len(dosyalar) * 2, len(eksik)))
    with ThreadPoolExecutor(8) as ex:
        hatalar = [h for h in ex.map(gorsel_yukle, eksik) if h]
    if hatalar:
        print("\n".join(hatalar[:10]))
        sys.exit("%d görsel yüklenemedi; komutu tekrar çalıştırın." % len(hatalar))

    urunler = [{
        "id": r[0], "ad": r[1], "kod": r[2] or "", "barkod": r[3] or "", "tedarikci": r[4] or "",
        "olcu": r[5] or "", "alis": r[6] or 0, "alis_kdv": r[7] or 0, "fiyat": r[8] or 0,
        "kat": kslug[r[9]], "alt": aslug[r[10]], "gorseller": gorsel.get(r[0], []),
    } for r in con.execute("""SELECT id, ad, kod, barkod, tedarikci, olcu, alis_fiyati_kdvsiz,
            alis_fiyati_kdvli, satis_fiyati, kategori_id, alt_kategori_id FROM urunler ORDER BY id""")]
    ekle("urunler", urunler, "id")
    print("Ürünler gönderildi: %d" % len(urunler))

    kullanici_olustur()
    print("\nTamam.")


_depo = {}


def depodakiler_cache(boy):
    if boy not in _depo:
        _depo[boy] = depodakiler(boy)
    return _depo[boy]


if __name__ == "__main__":
    main()
