# Doodle District · Remix

## Orijinal oyun ve teşekkür

Bu sürüm, **iifor** tarafından paylaşılan [DoodleShooter / Doodle District](https://github.com/iifor/doodleshooter) oyununun topluluk düzenlemesidir. Orijinal yapımcıya teşekkürler!

- [Orijinal oyunu oyna](https://doodleshooter.vercel.app/)
- [Orijinal GitHub kaynak kodu](https://github.com/iifor/doodleshooter)

Bu teşekkür ve bağlantılar ana menüde de görünür.

## Oyna

Windows’ta **OYNA.cmd** dosyasına çift tıkla. Python 3 ile yerel sunucuyu açar ve oyunu tarayıcıda gösterir. Bu bilgisayardaki Codex Python kurulumu otomatik bulunur.

Alternatif: oyun klasöründe `python serve.py 8911` çalıştır ve `http://127.0.0.1:8911` adresini aç. ES modülleri nedeniyle index.html dosyasını HTTP sunucusu üzerinden açmalısın.

## Son paket

- Dron, havan ve RPG kaldırıldı. Mayın B tuşunda kaldı.
- MP5 ve SCAR-H kaldırıldı. Çift Tabanca eklendi: iki elde ayrı modeller, sırayla ateş, toplam 30 mermi. Toplam **11 ateşli silah + katana**.
- FAMAS nişanı taşıma kolunun üstüne hizalandı; görüş merkezini kapatmıyor.
- Sniper **2× / 4× / 8×**, DMR **2× / 3× / 4× / 6×** dürbün kullanır. Sağ tık basılıyken tekerlek veya +/− ile zoom değişir; dürbün kapalıyken tekerlek silah değiştirir. Nişan hassasiyeti zoom oranına göre azalır.
- Sık Orman, Kayıp Orman, Dust 2 · Remix ve Gökdelen Şehri eklendi. Toplam **11 harita**.
- Büyük ormanlar için sabit 95 birimlik eski harita dışı kontrolü kaldırıldı; sınırlar seçili haritadan alınır. Uzak dürbün atışı 600 birime ulaşır. Orman geometrisi görünmeyen alanların çizilmemesi için parçalara bölünür.
- Her haritada üç ördek ve üç kırlangıç uçuyor. Turuncu halkalı kuşa nişan alıp **Q basılı tut**: ip seni kuşa çeker, kuş hareket ettikçe taşır. Q’yu bırakınca çözülür; Space ile ipten sıçrayabilirsin.
- Kuşlar ve kâğıt uçaklar çevrimiçinde oda sahibinin saatine göre hareket eder. Sonradan katılan oyuncu da aynı hareket döngüsüne girer.
- Yeni silahlar, silah modelleri, hasar ve grapple ipleri çevrimiçi eşitlenir. Sonradan katılan oyuncu mevcut mayınları da görür.
- Çevrimiçi menü, oda kurma/katılma, skor ve yeniden doğma ekranları Türkçeleştirildi. Skor ekranındaki oyuncu adları metin olarak işlenir.

## Kontroller

| Tuş | İşlev |
| --- | --- |
| WASD / Shift | Hareket / koş |
| Space | Zıpla, havada bir kez daha zıpla; ipten sıçra |
| Sol / sağ tık | Ateş / nişan; katanada kes / gard |
| 1–6 | Tüfek, pompalı, keskin nişancı, katana, revolver, SMG |
| 7 / 8 / 9 / 0 | AK-47 / M4A1 / Çift Tabanca / FAMAS |
| Fare tekerleği | Dürbün açıkken zoom; diğer durumlarda silah değiştir (M249 ve DMR dahil) |
| R | Şarjör değiştir; boş şarjör yedek varsa otomatik dolar |
| F | Hızlı katana ve önceki silaha dönüş |
| Q basılı | Tutun ve ipi sar; bırakınca çözül. E kullanılmıyor |
| B | Mayın yerleştir |
| G basılı / bırak | Bomba yolunu ve alanını gör / fırlat |
| C veya Ctrl | Kay / havada atıl |
| Tab | Çevrimiçi skor tablosu |
| Esc / M | Menü / müzik |

Gamepad eşleşmeleri oyun menüsündeki Kontroller bölümünde gösterilir.

## Yeni silahların farkları

| Silah | Rol |
| --- | --- |
| AK-47 | Güçlü vuruş, belirgin geri tepme; 30 mermi |
| M4A1 | Hızlı ve dengeli, düşük geri tepme; 30 mermi |
| Çift Tabanca | İki elden sırayla yarı otomatik ateş; toplam 30 mermi |
| FAMAS | Her tıklamada üçlü seri; 30 mermi |
| M249 | Uzun süre ateş, daha uzun reload; 75 mermi |
| DMR | Yarı otomatik, 2–6× dürbün; 12 mermi |

Her birinin modeli, atış hızı, dağılımı, geri tepmesi ve PvP hasarı ayrı ayarlandı. FAMAS serisi silah değiştirince iptal olur; eksik şarjörle mermi sayısı negatife düşmez.

## Haritalar

Ana menüde harita kartını seçip OYNA’ya bas. Son seçimin saklanır. Esc → Ana menü ile harita değiştirebilirsin. Çevrimiçinde oda sahibi haritayı seçer.

| Harita | Oynanış |
| --- | --- |
| Karalama Mahallesi | Sokaklar, merkezi kule, depolar ve yangın merdivenleri |
| Konteyner Limanı | Konteynerler, yan koridorlar, yük alanları ve grapple vinci |
| Kâğıt Kanyonu | Açık vadi, teraslar, iki köprü ve uzun görüş hatları |
| Çatı Bahçeleri | Dört çatı parkı, yüksek köprüler ve dikey hareket |
| Çamlık Vadi | Açık merkez, çevrede çamlar, alçak siperler ve iki gözetleme noktası |
| Orman Düellosu | Küçük, simetrik ve kolay okunur VS alanı |
| Göl Kenarı | Açık çayır, iki iskele, çevrede ağaçlar ve seyrek siperler |
| Sık Orman | 288 × 288 birim; yüzlerce çam, kaya, çalı, devrik kütük, dört girilebilir kulübe ve kıvrılan patikalar |
| Kayıp Orman | 352 × 352 birim; geniş yapraklı ağaçlar ve çamlar, yoğun siperler, dört harabe ve uzak açıklıklar |
| Dust 2 · Remix | A/B alanları, orta kapılar, uzun yol, yükseltilmiş kısa yol ve kapalı B tüneli |
| Gökdelen Şehri | 188 × 188 birim; 24 adet 22–50 birim yüksek bina, yüksek geçitler, çatı halkaları, park ve sokaklar |

### Dust 2 yeniden yapımı

A/CT ortasındaki bağımsız gri merdiven kaldırıldı. A platformunun güney kenarına bağlanan, zemin renginde kesintisiz bir rampa eklendi. Haritanın dış hatları boyunca çatıların üstünden tavana kadar görünmez, ipe tutunulamayan duvarlar eklendi; harita dışındaki boşluğa uçularak çıkılamaz. İç bölgedeki çatılar kullanılabilir.

Bu düzeltmeden sonra 22 Dust 2 kontrolü geçti: CT alt geçidi, rampadan zıplamadan çıkış ve yedi dış kenarda 12/40/67 birim yükseklikten 70 birim/s hızla kaçış denemeleri ile güvenli iniş doğrulandı.

Önceki serbest yorum kaldırıldı. [CS2 radar planının](https://cs2caller.com/dust2/callouts) dış sınırları ve beş iç bina bloğu elle çizilerek koridorlar yeniden kuruldu. T spawn → üst tünel → B; üst tünel → merdiven → alt tünel → mid; mid → catwalk → short → A; dış long → iki kapı → long → A yolları birbirine bağlanır. CT, yükseltilmiş short köprüsünün altından geçebilir. Pit aşağıdadır; yan rampadan zıplamadan çıkılır.

Xbox, A/B sandıkları, B penceresi, B kapıları, mavi long konteyneri, arabalar, çatı pervazları, kubbe ve bölge işaretleri eklendi. Dust 2'ye özel kum/taş renkleri ve mavi gökyüzü kullanılır. Diğer haritalar kalem çizimi görünümünü korur. Menüdeki küçük plan yeni koridorları gösterir.

Harita tasarımı referansı: **Counter-Strike / Valve**, [Dust II sunumu](https://www.counter-strike.net/dust2/). Bu tarayıcı uyarlamasında modeller kodla üretilir; CS2'nin özgün modelleri, dokuları, birebir ölçüleri ve Source 2 aydınlatması bulunmaz. Solo dalgalar ve çevrimiçi herkes-tek modu kullanılır.

Şehirde bina yüzeylerine veya turuncu halkalara Q basılı tutarak çekil. Q’yu bırak, başka bir binaya nişan al ve tekrar bas; Space ipten sıçrama sağlar. İp enerjisini yere inerek daha hızlı yenileyebilirsin.

Mavi su alanları dekoratiftir ve üzerinden yürünebilir. On ek haritada bot yolları, güvenli ikmal/doğma noktaları ve en az 10 çevrimiçi doğma noktası vardır. Geometri rastgele değişmez; aynı haritayı açan oyuncular aynı engelleri görür.

## Önceki düzeltmeler korunuyor

- Duvara Space basarak sürekli sekme ve çift zıplamayı yenileme kaldırıldı.
- Uzak oyuncular ve botlar ateşli silahlarını baktıkları yöne doğrultur.
- Katana erişimi 3.8 birim, vuruş açısı yaklaşık 124 derece; aktif savuruş boyunca hedef başına tek hasar.
- Bomba yarıçapı 8.5 birim; duvar koruması ve alan önizlemesi var.
- Solo revolverin yedek cephanesi sınırsız; altı mermilik şarjör yine doldurulur. Katana öldürmeleri cephane kazandırır; dalga başında ikmal gelir.
- İkmal kutuları güvenli zemine taşınır, yakında oyuncuya çekilir, dolu oyuncu tarafından boşa tüketilmez.
- Mayın: üç stok, en fazla dört aktif; bir saniyede kurulur, duvar arkasını algılamaz, 90 saniyede söner. Cephane kutusu ve dalga başlangıcı stok yeniler.
- Reload, savuruş ve tutunma durumları silah değişiminde veya yeniden doğmada temizlenir.
- Patlama hasarı tek sahibinden gelir, yinelenen ağ mesajları tekrar hasar oluşturmaz.
- Geç dalgalarda aynı anda en fazla 28 düşman bulunur.

## Arkadaşlarınla oyna

1. Her oyuncu bu güncel paketi kendi bilgisayarında OYNA.cmd ile açsın.
2. ÇEVRİMİÇİ → Özel → Oda oluştur.
3. Oda kodunu arkadaşına ver; o da ÇEVRİMİÇİ ekranında kodu yazıp Katıl’a bassın.
4. Oda sahibi haritayı seçsin, ardından Maçı başlat’a basın. Maça sonradan katılmak da mümkün.

Bu paket ayrı v8 oda alanı kullanır; eski remix ve orijinal sürümdeki odalarla karışmaz. Eşleşme internet üzerindeki PeerJS hizmetini, oyun trafiği WebRTC doğrudan bağlantısını kullanır. İki farklı internet ağı arasındaki bağlantı NAT/firewall koşullarına bağlıdır; mevcut oyun TURN aktarma sunucusu sağlamaz.

## Doğrulama

Dust 2 yeniden yapımı sonrası **161 harita kontrolü + 14 Dust 2 geçiş/görünüm kontrolü + 28 gerçek iki istemcili çevrimiçi kontrol geçti (203 kontrol)**. Önceki sürümdeki 171 oyun ve 24 silah/orman/şehir kontrolü bu harita değişikliği için tekrar çalıştırılmadı.

Dust 2 kontrolleri, yedi rotayı gerçek karakter çarpışma sistemiyle zıplamadan/ip kullanmadan yürütür; CT alt geçidi, pit yüksekliği, duvar ayrımları ve harita değişiminde çizim stilinin geri gelmesi doğrulanır. `node tests/dust2.mjs` ile çalıştırılır.

- Headless Edge: gerçek klavye/fare ile oyun açma, silah seçimi, ateş, bomba, mayın, hareket ve menü.
- Oyun sınıfları: tüm ateşli silahların reload/cephane durumları, üçlü seri, katana, duvar zıplaması, mayınlar, yinelenen hasar ve hareketli kuşa tutunma.
- Haritalar: tüm yeni doğma/ikmal noktalarının zemini ve açıklığı, bot yolları, merdiven yürüyüşleri, harita geçişi ve 640 px menü taşması.
- Aynı bilgisayarda iki ayrı Edge tarayıcı bağlamı, gerçek PeerJS özel odası ve WebRTC bağlantısıyla test edildi. Oda kurma/kodla katılma düğmeleri, geç katılım, harita, mevcut mayınlar, güncel uzak silah modelleri ve iki elde çift tabanca, AK-47 PvP hasarı, kuş saat eşitlemesi, Q ile uçma ve karşı oyuncudaki ip doğrulandı.
- Yeni özellik testleri: FAMAS nişan hizası ve görüş engeli, iki elden sırayla ateş, reload, iki dürbünde zoom giriş/çıkış/sınırları, orman yoğunluğu ve saklanma, şehirde sokaktan yükselme ve havada ikinci binaya tutunma.
- Dört yeni harita iki çevrimiçi istemcide açıldı ve çarpışma geometrileri karşılaştırıldı.
- Masaüstü harita, dürbün, çift tabanca ve menü ekran görüntüleri incelendi. JavaScript sözdizimi ve git diff whitespace kontrolü geçti.

Browser plugin not available: tarayıcı testleri kurulu Playwright ve Edge ile yürütüldü. Fiziksel gamepad, iki farklı internet bağlantısı ve uzun süreli insanlı denge testi yapılmadı.

Yerel sunucu açıkken:

```powershell
node tests/run.mjs
node tests/maps.mjs
node tests/online.mjs
node tests/expansion.mjs
```

Normal Playwright kurulumunda ortam değişkenini vermeyebilirsin. Başka sunucu için GAME_URL kullanılır. Çevrimiçi test internet gerektirir ve yalnızca kendi özel odasını oluşturur; test sonunda bağlantıları kapatır.

Kaynak: [iifor/doodleshooter](https://github.com/iifor/doodleshooter), başlangıç commit’i `8d8fad9ebeff2564881f427f4365336db98941b7`. Remix deposu: [Rekl0w/doodleshooter-remix](https://github.com/Rekl0w/doodleshooter-remix).
