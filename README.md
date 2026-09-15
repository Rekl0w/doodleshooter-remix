# DoodleShooter Remix

**11 harita, 11 ateşli silah, katana ve Q ile uçuş.** Tarayıcıda tek başına dalgalara karşı hayatta kal veya arkadaşlarınla çevrimiçi herkes-tek oyna.

## Orijinal oyun ve teşekkür

Bu proje, [iifor/doodleshooter](https://github.com/iifor/doodleshooter) oyununun topluluk tarafından geliştirilmiş Remix sürümüdür. Orijinal oyunun yapımcısına ve katkıda bulunanlara teşekkürler. Oyun içindeki ana menüde de orijinal kaynak ve oyun bağlantıları bulunur.

- **Orijinal oyunu oyna:** [doodleshooter.vercel.app](https://doodleshooter.vercel.app/)
- **Orijinal kaynak:** [iifor/doodleshooter](https://github.com/iifor/doodleshooter)
- **Remix kaynak:** [Rekl0w/doodleshooter-remix](https://github.com/Rekl0w/doodleshooter-remix)
- [Orijinal README](docs/UPSTREAM_README.md) ve Git geçmişi korunmuştur.

## Remix'te neler var?

- **11 harita:** yakın çatışma alanları, yoğun ve büyük ormanlar, Dust 2 uyarlaması ve 24 yüksek binalı Gökdelen Şehri.
- **Silahlar:** tüfek, pompalı, sniper, revolver, SMG, AK-47, M4A1, çift tabanca, FAMAS, M249, DMR ve katana.
- **Ayarlanabilir dürbünler:** sniper 2× / 4× / 8×; DMR 2× / 3× / 4× / 6×.
- **Grapple:** Q basılıyken tutun ve ipi sar; bırakınca momentumla devam et. Uçan ördek ve kırlangıçlara da tutunabilirsin.
- **Bomba ve mayınlar:** genişletilmiş patlama alanı, duvar koruması ve çevrimiçi eşitleme.
- **Akıcı solo:** iyileştirilmiş mühimmat ikmali ve yedek cephanesi sınırsız revolver.
- **Türkçe menüler**, harita önizlemeleri, fare hassasiyeti ve gamepad desteği.
- Duvar zıplaması istismarı, silah tutuşu, reload durumları ve harita dışına düşme sorunlarına yönelik düzeltmeler.

## Kontroller

| Eylem | Tuş |
| --- | --- |
| Hareket / bakış | WASD / fare |
| Koş / kay | Shift / C veya Ctrl |
| Ateş / katana savur | Sol tık |
| Nişan / katana gardı | Sağ tık |
| Zıpla / ipten sıçra | Space |
| Tutun ve ipi sar | Q basılı tut; bırakınca ip çözülür |
| Hızlı katana | F veya V |
| Reload | R |
| Bomba | G; basılı tutarak uzağa at |
| Mayın | B |
| Silah seç | 1–9, 0 veya fare tekerleği |
| Dürbün yakınlaştır / uzaklaştır | Nişan alırken tekerlek veya + / − |
| Skor tablosu | Tab |
| Menü / müzik | Esc / M |

M249 ve DMR'ye tekerlekle geçilir. E tuşu ip sarmaz. Gamepad tuşları oyun içindeki **Kontroller** bölümünde gösterilir.

## Haritalar

| Harita | Oyun alanı |
| --- | --- |
| Karalama Mahallesi | Sokaklar, çatılar, yangın merdivenleri |
| Konteyner Limanı | Konteynerler, vinçler, dar geçişler |
| Kâğıt Kanyonu | Açık atış hatları ve teraslar |
| Çatı Bahçeleri | Köprülerle bağlanan yüksek parklar |
| Çamlık Vadi | Açık merkez ve çevresinde orman |
| Orman Düellosu | Küçük ve simetrik VS alanı |
| Göl Kenarı | İskeleler ve açık çayır |
| Sık Orman | 288 × 288; yoğun çamlar, kayalar, kulübeler |
| Kayıp Orman | 352 × 352; harabeler ve geniş saklanma alanları |
| Dust 2 · Remix | Radar planından yeniden kurulan long, short, mid, A/B ve tüneller |
| Gökdelen Şehri | 24 bina, yüksek köprüler ve grapple rotaları |

![Dust 2 — A rampası](docs/images/dust2.png)
![Gökdelen Şehri](docs/images/skyline.png)

Dust II harita referansı **Counter-Strike / Valve**'a aittir. [Valve'ın Dust II sunumu](https://www.counter-strike.net/dust2/) ve [CS2 radar planı](https://cs2caller.com/dust2/callouts) referans alınmıştır. Bu sürümdeki geometri kodla üretilir; CS2'nin özgün modelleri, dokuları, birebir ölçüleri veya bomba kurma modu bulunmaz.

## Arkadaşlarınla oyna

1. Herkes aynı güncel oyun adresini açsın.
2. **ÇEVRİMİÇİ → Özel → Oda oluştur** yolunu izle.
3. Oda kodunu arkadaşına ver; o da kodla katılsın.
4. Oda sahibi haritayı seçsin, ardından maçı başlatın.

En fazla **10 oyuncu**, hedef **20 öldürme**. Maça sonradan katılım desteklenir. Açık oda için hızlı eşleşme kullanılabilir.

PeerJS eşleşmeyi, WebRTC oyuncular arasındaki trafiği sağlar. Oda sahibinin tarayıcısı maçı yönetir. Bu sürüm `v8` oda alanını kullanır; eski sürümlerle karışmaz. İnternet bağlantısı gerekir; bazı NAT/firewall türleri bağlantıyı engelleyebilir. TURN aktarma sunucusu ve sunucu taraflı anti-cheat bulunmaz.

## Yerelde çalıştır

Python 3 ile:

```bash
python serve.py 8911
```

Ardından [localhost:8911](http://127.0.0.1:8911/) adresini aç. Windows'ta `OYNA.cmd` dosyasına çift tıklamak da yeterlidir. ES modülleri nedeniyle oyunu `file://` üzerinden açma.

## Netlify / statik yayın

Oyun derleyiciye veya çalışma zamanı sunucusuna ihtiyaç duymaz. Yayın klasörü oluşturmak için Node.js 22+ ile:

```bash
node scripts/build.mjs
```

Bu komut yalnızca oyun dosyalarını `dist/` içine kopyalar; belgeler, testler ve yerel çalıştırma araçları yayınlanmaz.

Netlify ayarları `netlify.toml` içinde hazırdır:

- **Branch:** `main`
- **Build command:** `node scripts/build.mjs`
- **Publish directory:** `dist`
- **Environment variables:** gerekmez

GitHub deposundan içe aktarabilir veya yerelde oluşturulan `dist/` klasörünü manuel yükleyebilirsin. Diğer statik hosting hizmetlerinde de `dist/` içeriğini yayınla. Dosyalar yeniden doğrulanan önbellek başlıkları kullanır; güncellemeler sonraki sayfa yenilemesinde alınır.

## Testler

Yerel sunucuyu aç; ardından bir Playwright kurulumu ile:

```bash
npm install --no-save --package-lock=false playwright
npx playwright install chromium
node tests/run.mjs
node tests/maps.mjs
node tests/expansion.mjs
node tests/dust2.mjs
node tests/online.mjs
```

Windows'ta testler kurulu Microsoft Edge'i kullanır. Başka adreste test için `GAME_URL`, harici Playwright kurulumu için `PLAYWRIGHT_MODULE` tanımlanabilir. Online test kendi özel odasını açar ve internet bağlantısı ister.

Test kapsamı: hareket/cephane/hasar, harita geçişleri, güvenli spawn ve bot yolları, dürbünler, çift tabanca, Dust 2 yürüyüş rotaları ve görünmez sınırlar, iki gerçek WebRTC istemcisi arasında eşitleme. Son kontrollerin ayrıntıları [REMIX.md](REMIX.md) içindedir.

## Teknoloji ve katkı

JavaScript ES modülleri, [Three.js](https://threejs.org/), [PeerJS](https://peerjs.com/) ve Web Audio. Oyun geometrisi ve sesleri büyük ölçüde kodla üretilir. Tarayıcı bağımlılıkları `vendor/` altında bulunur.

Hata bildirirken harita adını, silahı, solo/online modunu ve tekrar etme adımlarını ekle. Değişikliklerde orijinal yapımcı kredilerini koru.
