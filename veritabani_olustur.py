# -*- coding: utf-8 -*-
"""
STOK LİSTESİ.xlsx -> katalog.db (SQLite) + katalog/data.js + katalog/img/

Excel güncellendiğinde bu dosyayı tekrar çalıştırın:
    python veritabani_olustur.py

Yönetim ekranından elle eklenen ürünler ve silinen ürünler korunur.
"""
import glob
import hashlib
import io
import json
import os
import posixpath
import re
import sqlite3
import sys
import zipfile
import xml.etree.ElementTree as ET

import openpyxl
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.join(ROOT, "katalog")
IMG_T = os.path.join(SITE, "img", "k")   # küçük (liste)
IMG_F = os.path.join(SITE, "img", "b")   # büyük (detay)
DB = os.path.join(ROOT, "katalog.db")

NS = {
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
    "rd": "http://schemas.microsoft.com/office/spreadsheetml/2017/richdata",
    "rvrel": "http://schemas.microsoft.com/office/spreadsheetml/2022/richvaluerel",
}

# ---------------------------------------------------------------- kategoriler
# (kategori, alt kategori, regex) - ilk eşleşen kazanır. Ürün adları BÜYÜK harf.
RULES = [
    ("Kitap & Kitap Kutusu", "Orijinal Kitap", r"ORJ KİTAP|KİTAP ORJ"),
    ("Masa Üstü Aksesuar", "Kitap Tutucu", r"KİTAP TUTUCU"),
    ("Kitap & Kitap Kutusu", "Dekoratif Kitap Kutu", r"^KİTAP"),

    ("Mum & Oda Kokusu", "Oda Kokusu", r"^ODA KOKUSU"),
    ("Mum & Oda Kokusu", "Mum", r"^MUM "),

    ("Saat & Kum Saati", "Kum Saati", r"KUM SAATİ"),
    ("Saat & Kum Saati", "Masa & Duvar Saati", r"^SAAT |MASA SAATİ|DUVAR SAATİ"),

    ("Aydınlatma", "Abajur & Masa Lambası", r"^ABAJUR|MASA LAMBASI|TABLE LAMP"),
    ("Aydınlatma", "Aplik", r"^APLİK"),

    ("Oyun & Satranç", "Satranç", r"SATRANÇ|^STRANÇ"),
    ("Oyun & Satranç", "Tavla & XOX", r"^TAVLA|^OXO|^XOX"),

    ("Banyo", "Banyo Seti", r"^BANYO"),

    ("Saksı & Çiçek", "Yapay Çiçek & Bitki", r"^YAPAY|POLYESTER GÜL"),

    ("Kutu & Takı Kutusu", "Takı Kutusu", r"TAKI KUTUSU"),
    ("Kutu & Takı Kutusu", "Dekoratif Kutu", r"^KUTU|^METAL KUTU|^SANDIK"),

    ("Çerçeve", "Çerçeve", r"^ÇERÇEVE|^ÇERÇVE|^ÇERÇECE"),
    ("Tepsi", "Tepsi", r"^TEPSİ"),

    ("Masa Üstü Aksesuar", "Büyüteç", r"^BÜYÜTEÇ"),
    ("Masa Üstü Aksesuar", "Teleskop & Dürbün", r"^TELESKOP|^DÜRBÜN"),
    ("Masa Üstü Aksesuar", "Küllük", r"^KÜLLÜK"),
    ("Masa Üstü Aksesuar", "Ofis Aksesuarı", r"MEKTUP AÇACAK|^RAHLE"),

    ("Mumluk & Şamdan", "Şamdan", r"^ŞAMDAN|ŞAMDAN"),
    ("Mumluk & Şamdan", "Mumluk", r"MUMLUK|^FENER|HURRICANE|CANDLE HOLDER"),

    ("Saksı & Çiçek", "Saksı & Çiçeklik", r"SAKSI|ÇİÇEKLİK|^JARDENYER"),

    ("Duvar Dekoru", "Tablo", r"^TABLO"),
    ("Duvar Dekoru", "Ayna", r"^AYNA"),
    ("Duvar Dekoru", "Duvar Objesi", r"^DUVAR|DUVAR DEKOR|DUVAR OBJE"),

    ("Mobilya", "Puf & Sehpa", r"^PUF|^SEHPA|^GAZETELİK"),

    ("Dekoratif Şişe", "Parfüm Şişesi", r"PARFÜM ŞİŞE"),
    ("Dekoratif Şişe", "Cam Şişe", r"^ŞİŞE|^CAM ŞİŞE|DEKOR ŞİŞE"),

    ("Vazo & Küp", "Küp", r"^KÜP"),
    ("Vazo & Küp", "Vazo", r"VAZO|^KAKTÜS"),

    ("Dekoratif Obje", "Fanus", r"^FANUS|CAM FANUS"),

    ("Mutfak & Sofra", "Yemek & Çatal Kaşık Takımı", r"YEMEK TAKIMI|^ÇKB|ÇATAL KAŞIK"),
    ("Mutfak & Sofra", "Kase & Çerezlik", r"^KASE|^EL KASE|ÇEREZLİK|MİNİ KASE|İSTİRİDYE KASE|BOWL|^ŞEKERLİK|^KAVANOZ|^MEYVELİK"),
    ("Mutfak & Sofra", "Servis & Sunum", r"^MUTFAK|^SUNUM|^SERVİS|^TABAK|^FİNCAN|^ÇAYDANLIK|^KEK STANDI|^BUZLUK|^BUZ KOVASI|^SÜRAHİ|^KARAF"),

    ("Heykel & Figür", "Karakter Figürleri", r"^MICKEY|^MINNIE|^ASTRONOT|^SQUID|^KARL |BUGS BUNNY|BALLOON DOG|BALLON GOD"),
    ("Heykel & Figür", "Hayvan Figürleri", r"^AT |^ASLAN|^LEOPAR|^KAPLAN|^GORİL|^GORILLA|^KÖPEK|^KUŞ|^JAGUAR|^KARTAL|^TİMSAH|^TAVŞAN|^AYI |ZÜRAFA|BULLDOG|TRUVA AT|ŞEFFAF AT|PUMA|^TIRTIL"),
    ("Heykel & Figür", "Heykel & Büst", r"HEYKEL|BÜST|^KOLLARI|^SEPETLİ|KURU ?KAFA|BALERİN|MEDUSA|EL MODELİ|^KOL |THE HAND|(?<!\w)EL DEKOR"),

    ("Dekoratif Obje", "Mercan & Deniz Kabuğu", r"^MERCAN|^İSTİRİDYE|^DENİZ KABUĞU"),
    ("Dekoratif Obje", "Mermer Obje", r"^MERMER"),
    ("Dekoratif Obje", "Küre & Top", r"^KÜRE|^TOP |^DÜNYA|3 LÜ TOPLAR|TOPLU KÜRE"),
    ("Cam & Kristal Obje", "Kristal Obje", r"^KRİSTAL|^ZAR "),
    ("Cam & Kristal Obje", "Cam Obje", r"^CAM |^ŞEFFAF|CAM DEKOR|CAM OBJE"),
    ("Dekoratif Obje", "Zincir & Düğüm", r"^ZİNCİR|^DÜĞÜM|^SONSUZLUK"),
]
DEFAULT = ("Dekoratif Obje", "Dekoratif Obje")

CATEGORY_ORDER = [
    "Vazo & Küp", "Mumluk & Şamdan", "Mum & Oda Kokusu", "Heykel & Figür",
    "Dekoratif Obje", "Cam & Kristal Obje", "Dekoratif Şişe",
    "Kitap & Kitap Kutusu", "Kutu & Takı Kutusu", "Çerçeve", "Tepsi",
    "Mutfak & Sofra", "Saksı & Çiçek", "Masa Üstü Aksesuar",
    "Saat & Kum Saati", "Aydınlatma", "Duvar Dekoru", "Oyun & Satranç",
    "Banyo", "Mobilya",
]


def categorize(name):
    for cat, sub, pat in RULES:
        if re.search(pat, name):
            return cat, sub
    return DEFAULT


def slug(s):
    tr = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
    s = s.translate(tr).lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def clean(s):
    return re.sub(r"\s+", " ", str(s)).strip()


def dims(name):
    """Addan ölçü / hacim bilgisini ayıkla."""
    out = []
    m = re.search(r"(\d+(?:,\d+)?(?:\s*\*\s*\d+(?:,\d+)?)+)\s*(?:CM)?", name)
    if m:
        out.append(re.sub(r"\s*\*\s*", " × ", m.group(1)) + " cm")
    else:
        m = re.search(r"(\d+(?:,\d+)?)\s*CM\b", name)
        if m:
            out.append(m.group(1) + " cm")
    m = re.search(r"(\d+)\s*(ML|CC)\b", name)
    if m:
        out.append(m.group(1) + " " + m.group(2).lower())
    return " · ".join(out)


# -------------------------------------------------------------------- görseller
def rels(z, path):
    base = posixpath.dirname(posixpath.dirname(path))
    relp = posixpath.join(posixpath.dirname(path), "_rels", posixpath.basename(path) + ".rels")
    out = {}
    for r in ET.fromstring(z.read(relp)).findall("rel:Relationship", NS):
        out[r.get("Id")] = posixpath.normpath(posixpath.join(posixpath.dirname(path), r.get("Target")))
    return out


def drawing_images(z):
    """Hücre üstüne yerleştirilmiş resimler: satır(1-tabanlı) -> [media yolu]"""
    path = "xl/drawings/drawing1.xml"
    rmap = rels(z, path)
    out = {}
    root = ET.fromstring(z.read(path))
    for anc in root:
        fr = anc.find("xdr:from", NS)
        to = anc.find("xdr:to", NS)
        blip = anc.find(".//a:blip", NS)
        if fr is None or blip is None:
            continue
        r0 = int(fr.find("xdr:row", NS).text)
        o0 = int(fr.find("xdr:rowOff", NS).text)
        row = r0
        if to is not None:
            r1 = int(to.find("xdr:row", NS).text)
            o1 = int(to.find("xdr:rowOff", NS).text)
            # resim bir üst satırın en altından başlayıp asıl satıra taşıyorsa
            if r1 == r0 + 1 and o1 > 600000 and o0 > 600000:
                row = r1
        media = rmap.get(blip.get("{%s}embed" % NS["r"]))
        if media:
            out.setdefault(row + 1, []).append((o0, media))
    return {k: [m for _, m in sorted(v)] for k, v in out.items()}


def cell_images(z):
    """'Hücreye yerleştir' ile eklenen resimler (#VALUE! görünenler)."""
    try:
        rv = ET.fromstring(z.read("xl/richData/rdrichvalue.xml"))
        rvrel = ET.fromstring(z.read("xl/richData/richValueRel.xml"))
        meta = ET.fromstring(z.read("xl/metadata.xml"))
    except KeyError:
        return {}
    rmap = rels(z, "xl/richData/richValueRel.xml")
    rel_ids = [e.get("{%s}id" % NS["r"]) for e in rvrel]
    rv_rel = [int(e.find("rd:v", NS).text) for e in rv.findall("rd:rv", NS)]
    # valueMetadata bk[i] -> futureMetadata bk[v] -> rvb i
    fut = []
    for fm in meta.findall("m:futureMetadata", NS):
        if fm.get("name") == "XLRICHVALUE":
            for bk in fm.findall("m:bk", NS):
                rvb = bk.find(".//{*}rvb")
                fut.append(int(rvb.get("i")))
    vm = [int(bk.find("m:rc", NS).get("v")) for bk in meta.find("m:valueMetadata", NS).findall("m:bk", NS)]
    out = {}
    sheet = z.read("xl/worksheets/sheet1.xml").decode("utf-8")
    for m in re.finditer(r'<c r="A(\d+)"[^>]*?\bvm="(\d+)"', sheet):
        row, v = int(m.group(1)), int(m.group(2))
        try:
            media = rmap[rel_ids[rv_rel[fut[vm[v - 1]]]]]
        except (IndexError, KeyError):
            continue
        out.setdefault(row, []).append(media)
    return out


def save_image(raw):
    """Ham resim -> webp (küçük + büyük). Dönen: dosya adı ya da None"""
    os.makedirs(IMG_T, exist_ok=True)
    os.makedirs(IMG_F, exist_ok=True)
    fn = hashlib.md5(raw).hexdigest()[:12] + ".webp"
    tp, fp = os.path.join(IMG_T, fn), os.path.join(IMG_F, fn)
    if os.path.exists(tp) and os.path.exists(fp):
        return fn
    try:
        im = Image.open(io.BytesIO(raw))
        im.load()
    except Exception:
        return None
    if im.mode in ("RGBA", "LA", "P"):
        im = im.convert("RGBA")
        bg = Image.new("RGB", im.size, (255, 255, 255))
        bg.paste(im, mask=im.split()[-1])
        im = bg
    else:
        im = im.convert("RGB")
    big = im.copy()
    big.thumbnail((1400, 1400), Image.LANCZOS)
    big.save(fp, "WEBP", quality=82, method=4)
    im.thumbnail((440, 440), Image.LANCZOS)
    im.save(tp, "WEBP", quality=78, method=4)
    return fn


def convert_images(z, used):
    """media -> webp. Dönen: media yolu -> dosya adı"""
    done = {}
    for i, media in enumerate(sorted(used)):
        fn = save_image(z.read(media))
        if fn:
            done[media] = fn
        else:
            print("  ! okunamadı:", media)
        if i % 200 == 0:
            print("  görsel %d / %d" % (i, len(used)))
    return done


# ------------------------------------------------------------------ veritabanı
SCHEMA = """
    CREATE TABLE kategoriler (
        id INTEGER PRIMARY KEY, ad TEXT NOT NULL, slug TEXT NOT NULL UNIQUE, sira INTEGER);
    CREATE TABLE alt_kategoriler (
        id INTEGER PRIMARY KEY, kategori_id INTEGER NOT NULL REFERENCES kategoriler(id),
        ad TEXT NOT NULL, slug TEXT NOT NULL, UNIQUE(kategori_id, slug));
    CREATE TABLE urunler (
        id INTEGER PRIMARY KEY,            -- Excel satır numarası; elle eklenenler 100000+
        ad TEXT NOT NULL, kod TEXT, barkod TEXT, tedarikci TEXT, olcu TEXT,
        alis_fiyati_kdvsiz REAL, alis_fiyati_kdvli REAL, satis_fiyati REAL,
        kategori_id INTEGER REFERENCES kategoriler(id),
        alt_kategori_id INTEGER REFERENCES alt_kategoriler(id),
        manuel INTEGER NOT NULL DEFAULT 0); -- 1: yönetim ekranından eklendi
    CREATE TABLE urun_gorselleri (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        urun_id INTEGER NOT NULL REFERENCES urunler(id), dosya TEXT NOT NULL, sira INTEGER);
    -- yönetim ekranından silinen Excel ürünleri (Excel yeniden aktarılınca geri gelmesin)
    CREATE TABLE silinenler (
        anahtar TEXT PRIMARY KEY, ad TEXT, kod TEXT, tarih TEXT);
    CREATE INDEX ix_urun_kod ON urunler(kod);
    CREATE INDEX ix_urun_kat ON urunler(kategori_id, alt_kategori_id);
    CREATE INDEX ix_gorsel_urun ON urun_gorselleri(urun_id);
"""
MANUEL_ID = 100000


def anahtar(ad, kod):
    return (kod or "") + "|" + ad


def onceki_durum():
    """Yeniden kurulumdan önce elle eklenen ve silinen ürünleri oku."""
    if not os.path.exists(DB):
        return [], []
    con = sqlite3.connect(DB)
    try:
        sil = con.execute("SELECT anahtar, ad, kod, tarih FROM silinenler").fetchall()
        man = []
        for r in con.execute("""SELECT u.id, u.ad, u.kod, u.barkod, u.tedarikci, u.olcu,
                    u.alis_fiyati_kdvsiz, u.alis_fiyati_kdvli, u.satis_fiyati, k.ad, a.ad
                FROM urunler u JOIN kategoriler k ON k.id=u.kategori_id
                JOIN alt_kategoriler a ON a.id=u.alt_kategori_id WHERE u.manuel=1""").fetchall():
            imgs = [g[0] for g in con.execute(
                "SELECT dosya FROM urun_gorselleri WHERE urun_id=? ORDER BY sira", (r[0],))]
            man.append({"id": r[0], "ad": r[1], "kod": r[2], "barkod": r[3], "tedarikci": r[4],
                        "olcu": r[5], "alis_kdvsiz": r[6], "alis_kdvli": r[7], "fiyat": r[8],
                        "kategori": r[9], "alt": r[10], "gorseller": imgs, "manuel": 1})
        return man, sil
    except sqlite3.OperationalError:      # eski şema
        return [], []
    finally:
        con.close()


def data_js_yaz(con):
    """Veritabanından önyüz verisini (katalog/data.js) üret.
    Alış fiyatı ve tedarikçi ekranda görünür, proforma belgesine yazılmaz."""
    kats = con.execute("SELECT id, ad, slug FROM kategoriler ORDER BY sira").fetchall()
    alts = con.execute("SELECT id, kategori_id, ad, slug FROM alt_kategoriler ORDER BY id").fetchall()
    kslug = {k[0]: k[2] for k in kats}
    aslug = {a[0]: a[3] for a in alts}
    imgs = {}
    for uid, fn in con.execute("SELECT urun_id, dosya FROM urun_gorselleri ORDER BY urun_id, sira"):
        imgs.setdefault(uid, []).append(fn)
    urunler = []
    for r in con.execute("""SELECT id, ad, kod, barkod, satis_fiyati, kategori_id, alt_kategori_id,
            olcu, alis_fiyati_kdvsiz, alis_fiyati_kdvli, tedarikci, manuel FROM urunler ORDER BY id"""):
        u = {"id": r[0], "ad": r[1], "kod": r[2] or "", "barkod": r[3] or "", "fiyat": r[4] or 0,
             "kat": kslug[r[5]], "alt": aslug[r[6]], "olcu": r[7] or "", "img": imgs.get(r[0], []),
             "alis": r[8] or 0, "alisKdv": r[9] or 0, "ted": r[10] or ""}
        if r[11]:
            u["m"] = 1
        urunler.append(u)
    data = {
        "kategoriler": [
            {"ad": k[1], "slug": k[2],
             "alt": [{"ad": a[2], "slug": a[3]} for a in alts if a[1] == k[0]]}
            for k in kats],
        "urunler": urunler,
        # önyüzde (sunucusuz) eklenen ürünlerin kategorisini addan bulmak için
        "kurallar": [[slug(c), slug(x), pat] for c, x, pat in RULES] + [[slug(DEFAULT[0]), slug(DEFAULT[1]), ""]],
    }
    # Önyüz artık veriyi Supabase'den okur; data.js yalnızca yerel yedek/inceleme içindir (git'e girmez).
    os.makedirs(SITE, exist_ok=True)
    with open(os.path.join(SITE, "data.js"), "w", encoding="utf-8") as f:
        f.write("window.KATALOG = ")
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")
    # yeni eklenen ürünün kategorisini addan bulmak için kurallar (önyüz kullanır)
    with open(os.path.join(SITE, "kurallar.js"), "w", encoding="utf-8") as f:
        f.write("window.KURALLAR = ")
        json.dump(data["kurallar"], f, ensure_ascii=False, separators=(",", ":"))
        f.write(";\n")


# ------------------------------------------------------------------------ main
def main():
    xl = [f for f in glob.glob(os.path.join(ROOT, "*.xlsx")) if not os.path.basename(f).startswith("~$")]
    if not xl:
        sys.exit("Klasörde .xlsx bulunamadı")
    xl = xl[0]
    print("Excel:", os.path.basename(xl))

    manuel, silinen = onceki_durum()
    sil_set = {s[0] for s in silinen}

    z = zipfile.ZipFile(xl)
    dimg = drawing_images(z)
    cimg = cell_images(z)
    print("Resimli satır: %d (çizim) + %d (hücre içi)" % (len(dimg), len(cimg)))

    wb = openpyxl.load_workbook(xl, data_only=True)
    ws = wb.worksheets[0]

    products = []
    for rno, r in enumerate(ws.iter_rows(min_row=2, max_col=9, values_only=True), start=2):
        if not r[1]:
            continue
        name = clean(r[1])
        kod = clean(r[2]) if r[2] not in (None, "") else ""
        if anahtar(name, kod) in sil_set:
            continue
        cat, sub = categorize(name.upper())
        num = lambda v: round(float(v), 2) if isinstance(v, (int, float)) else 0.0
        bc = r[7]
        products.append({
            "id": rno,
            "ad": name,
            "kod": kod,
            "alis_kdvsiz": num(r[3]),
            "alis_kdvli": num(r[4]),
            "fiyat": num(r[5]),
            "tedarikci": clean(r[6]) if r[6] else "",
            "barkod": str(int(bc)) if isinstance(bc, (int, float)) else (clean(bc) if bc else ""),
            "kategori": cat,
            "alt": sub,
            "olcu": dims(name.upper()),
            "media": cimg.get(rno, []) + dimg.get(rno, []),
            "manuel": 0,
        })

    used = {m for p in products for m in p["media"] if not m.lower().endswith(".wdp")}
    print("Ürün: %d, kullanılan görsel dosyası: %d" % (len(products), len(used)))
    conv = convert_images(z, used)
    for p in products:
        seen, imgs = set(), []
        for m in p.pop("media"):
            fn = conv.get(m)
            if fn and fn not in seen:
                seen.add(fn)
                imgs.append(fn)
        p["gorseller"] = imgs
    products += manuel

    # ---- SQLite
    if os.path.exists(DB):
        os.remove(DB)
    con = sqlite3.connect(DB)
    con.executescript(SCHEMA)
    con.executemany("INSERT INTO silinenler VALUES (?,?,?,?)", silinen)
    # kategoriler ürün olmasa da hep yazılır (yönetim ekranında seçilebilsin)
    subs = []
    for c, s in [(c, s) for c, s, _ in RULES] + [DEFAULT]:
        if (c, s) not in subs:
            subs.append((c, s))
    cat_id, sub_id = {}, {}
    for i, c in enumerate(CATEGORY_ORDER, 1):
        cat_id[c] = i
        con.execute("INSERT INTO kategoriler VALUES (?,?,?,?)", (i, c, slug(c), i))
    for c, s in subs:
        sub_id[(c, s)] = len(sub_id) + 1
        con.execute("INSERT INTO alt_kategoriler VALUES (?,?,?,?)",
                    (sub_id[(c, s)], cat_id[c], s, slug(s)))
    for p in products:
        if (p["kategori"], p["alt"]) not in sub_id:      # kuralı kaldırılmış eski kategori
            p["kategori"], p["alt"] = DEFAULT
        con.execute("INSERT INTO urunler VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", (
            p["id"], p["ad"], p["kod"], p["barkod"], p["tedarikci"], p["olcu"],
            p["alis_kdvsiz"], p["alis_kdvli"], p["fiyat"],
            cat_id[p["kategori"]], sub_id[(p["kategori"], p["alt"])], p["manuel"]))
        for i, fn in enumerate(p["gorseller"]):
            con.execute("INSERT INTO urun_gorselleri (urun_id, dosya, sira) VALUES (?,?,?)",
                        (p["id"], fn, i))
    con.commit()
    data_js_yaz(con)
    con.close()

    # kullanılmayan eski görselleri temizle
    keep = {fn for p in products for fn in p["gorseller"]}
    for d in (IMG_T, IMG_F):
        for fn in os.listdir(d):
            if fn not in keep:
                os.remove(os.path.join(d, fn))

    print("\nÖZET")
    print("  ürün:", len(products), "| görselsiz:", sum(1 for p in products if not p["gorseller"]),
          "| fiyatsız:", sum(1 for p in products if not p["fiyat"]),
          "| elle eklenen:", len(manuel), "| silinmiş:", len(silinen))
    for c in CATEGORY_ORDER:
        print("  %-24s %d" % (c, sum(1 for p in products if p["kategori"] == c)))
    return products


if __name__ == "__main__":
    main()
