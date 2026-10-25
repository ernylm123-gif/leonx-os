/**
 * LEONX Radar — Türkiye il/ilçe sözlüğü ve çekim ekine dayanıklı konum eşleştirme.
 *
 * • 81 il (plaka sırası) ve 81 ilin tüm ilçeleri ("Merkez" ilçeler hariç; il adıyla aynı anlamdadır).
 *   Yaygın eski/kısa adlar ("Afyon", "Antep", "Maraş", "Urfa", "İzmit", "İçel") kabul edilir.
 * • Ankara ilçeleri önceliklidir: metinde başka il geçmiyorsa "Gölbaşı" Ankara sayılır.
 * • Diğer illerin ilçeleri: metinde ili de geçiyorsa ilçe olarak yazılır. İl geçmiyorsa yalnız
 *   ayırt edici (tek ilde bulunan, gündelik sözcük/kişi/kulüp adı olmayan) ve Büyük harfle yazılmış
 *   ilçe adından il çıkarılır; güven düşüktür (0.6, ekliyse 0.7). "Pazar", "Kale", "Of", "Saray",
 *   "Akdeniz", "Beşiktaş", "Fatih"… gibi adlar tek başına konum sayılmaz.
 * • "Ankara'da", "Etimesgut'ta", "Ankarada", "İzmir'in" gibi çekimli biçimler eşleşir.
 * • Başka anlamı da olan adlar (Ordu = askeri birlik, Ağrı = acı, Van, Muş, Batman, Bala,
 *   Evren, Çubuk, Mamak…) yalnız büyük harfle yazılmışsa sayılır ve güveni düşüktür.
 * • Cadde/sokak/bulvar/yol adları konum sayılmaz: "Ankara Caddesi, Bornova/İzmir" → İzmir
 *   (Ankara değil). Bu davranış testlerde belgelenmiştir.
 * • Bir Ankara ilçesi bulunur ama metinde Ankara yerine BAŞKA bir il geçerse (ör. "Adıyaman
 *   Gölbaşı") o il seçilir; ilçe o ile aitse yazılır (Adıyaman / Gölbaşı), değilse boş bırakılır.
 */
import { fold, stemMatches } from './text.ts'

export const PROVINCES: string[] = [
  'Adana', 'Adıyaman', 'Afyonkarahisar', 'Ağrı', 'Amasya', 'Ankara', 'Antalya', 'Artvin', 'Aydın', 'Balıkesir',
  'Bilecik', 'Bingöl', 'Bitlis', 'Bolu', 'Burdur', 'Bursa', 'Çanakkale', 'Çankırı', 'Çorum', 'Denizli',
  'Diyarbakır', 'Edirne', 'Elazığ', 'Erzincan', 'Erzurum', 'Eskişehir', 'Gaziantep', 'Giresun', 'Gümüşhane', 'Hakkari',
  'Hatay', 'Isparta', 'Mersin', 'İstanbul', 'İzmir', 'Kars', 'Kastamonu', 'Kayseri', 'Kırklareli', 'Kırşehir',
  'Kocaeli', 'Konya', 'Kütahya', 'Malatya', 'Manisa', 'Kahramanmaraş', 'Mardin', 'Muğla', 'Muş', 'Nevşehir',
  'Niğde', 'Ordu', 'Rize', 'Sakarya', 'Samsun', 'Siirt', 'Sinop', 'Sivas', 'Tekirdağ', 'Tokat',
  'Trabzon', 'Tunceli', 'Şanlıurfa', 'Uşak', 'Van', 'Yozgat', 'Zonguldak', 'Aksaray', 'Bayburt', 'Karaman',
  'Kırıkkale', 'Batman', 'Şırnak', 'Bartın', 'Ardahan', 'Iğdır', 'Yalova', 'Karabük', 'Kilis', 'Osmaniye',
  'Düzce',
]

export const ANKARA_DISTRICTS: string[] = [
  'Çankaya', 'Yenimahalle', 'Etimesgut', 'Sincan', 'Gölbaşı', 'Pursaklar', 'Keçiören', 'Mamak', 'Altındağ', 'Kahramankazan',
  'Akyurt', 'Polatlı', 'Beypazarı', 'Elmadağ', 'Kalecik', 'Çubuk', 'Haymana', 'Kızılcahamam', 'Ayaş', 'Bala',
  'Çamlıdere', 'Evren', 'Güdül', 'Nallıhan', 'Şereflikoçhisar',
]

export const DISTRICTS: Record<string, string[]> = {
  Ankara: ANKARA_DISTRICTS,
  Adana: ['Aladağ', 'Ceyhan', 'Çukurova', 'Feke', 'İmamoğlu', 'Karaisalı', 'Karataş', 'Kozan', 'Pozantı', 'Saimbeyli', 'Sarıçam', 'Seyhan', 'Tufanbeyli', 'Yumurtalık', 'Yüreğir'],
  'Adıyaman': ['Besni', 'Çelikhan', 'Gerger', 'Gölbaşı', 'Kahta', 'Samsat', 'Sincik', 'Tut'],
  Afyonkarahisar: ['Başmakçı', 'Bayat', 'Bolvadin', 'Çay', 'Çobanlar', 'Dazkırı', 'Dinar', 'Emirdağ', 'Evciler', 'Hocalar', 'İhsaniye', 'İscehisar', 'Kızılören', 'Sandıklı', 'Sinanpaşa', 'Sultandağı', 'Şuhut'],
  'Ağrı': ['Diyadin', 'Doğubayazıt', 'Eleşkirt', 'Hamur', 'Patnos', 'Taşlıçay', 'Tutak'],
  Amasya: ['Göynücek', 'Gümüşhacıköy', 'Hamamözü', 'Merzifon', 'Suluova', 'Taşova'],
  Antalya: ['Akseki', 'Aksu', 'Alanya', 'Demre', 'Döşemealtı', 'Elmalı', 'Finike', 'Gazipaşa', 'Gündoğmuş', 'İbradı', 'Kaş', 'Kemer', 'Kepez', 'Konyaaltı', 'Korkuteli', 'Kumluca', 'Manavgat', 'Muratpaşa', 'Serik'],
  Artvin: ['Ardanuç', 'Arhavi', 'Borçka', 'Hopa', 'Kemalpaşa', 'Murgul', 'Şavşat', 'Yusufeli'],
  'Aydın': ['Bozdoğan', 'Buharkent', 'Çine', 'Didim', 'Efeler', 'Germencik', 'İncirliova', 'Karacasu', 'Karpuzlu', 'Koçarlı', 'Köşk', 'Kuşadası', 'Kuyucak', 'Nazilli', 'Söke', 'Sultanhisar', 'Yenipazar'],
  'Balıkesir': ['Altıeylül', 'Ayvalık', 'Balya', 'Bandırma', 'Bigadiç', 'Burhaniye', 'Dursunbey', 'Edremit', 'Erdek', 'Gömeç', 'Gönen', 'Havran', 'İvrindi', 'Karesi', 'Kepsut', 'Manyas', 'Marmara', 'Savaştepe', 'Sındırgı', 'Susurluk'],
  Bilecik: ['Bozüyük', 'Gölpazarı', 'İnhisar', 'Osmaneli', 'Pazaryeri', 'Söğüt', 'Yenipazar'],
  'Bingöl': ['Adaklı', 'Genç', 'Karlıova', 'Kiğı', 'Solhan', 'Yayladere', 'Yedisu'],
  Bitlis: ['Adilcevaz', 'Ahlat', 'Güroymak', 'Hizan', 'Mutki', 'Tatvan'],
  Bolu: ['Dörtdivan', 'Gerede', 'Göynük', 'Kıbrıscık', 'Mengen', 'Mudurnu', 'Seben', 'Yeniçağa'],
  Burdur: ['Ağlasun', 'Altınyayla', 'Bucak', 'Çavdır', 'Çeltikçi', 'Gölhisar', 'Karamanlı', 'Kemer', 'Tefenni', 'Yeşilova'],
  Bursa: ['Büyükorhan', 'Gemlik', 'Gürsu', 'Harmancık', 'İnegöl', 'İznik', 'Karacabey', 'Keles', 'Kestel', 'Mudanya', 'Mustafakemalpaşa', 'Nilüfer', 'Orhaneli', 'Orhangazi', 'Osmangazi', 'Yenişehir', 'Yıldırım'],
  'Çanakkale': ['Ayvacık', 'Bayramiç', 'Biga', 'Bozcaada', 'Çan', 'Eceabat', 'Ezine', 'Gelibolu', 'Gökçeada', 'Lapseki', 'Yenice'],
  'Çankırı': ['Atkaracalar', 'Bayramören', 'Çerkeş', 'Eldivan', 'Ilgaz', 'Kızılırmak', 'Korgun', 'Kurşunlu', 'Orta', 'Şabanözü', 'Yapraklı'],
  'Çorum': ['Alaca', 'Bayat', 'Boğazkale', 'Dodurga', 'İskilip', 'Kargı', 'Laçin', 'Mecitözü', 'Oğuzlar', 'Ortaköy', 'Osmancık', 'Sungurlu', 'Uğurludağ'],
  Denizli: ['Acıpayam', 'Babadağ', 'Baklan', 'Bekilli', 'Beyağaç', 'Bozkurt', 'Buldan', 'Çal', 'Çameli', 'Çardak', 'Çivril', 'Güney', 'Honaz', 'Kale', 'Merkezefendi', 'Pamukkale', 'Sarayköy', 'Serinhisar', 'Tavas'],
  'Diyarbakır': ['Bağlar', 'Bismil', 'Çermik', 'Çınar', 'Çüngüş', 'Dicle', 'Eğil', 'Ergani', 'Hani', 'Hazro', 'Kayapınar', 'Kocaköy', 'Kulp', 'Lice', 'Silvan', 'Sur', 'Yenişehir'],
  Edirne: ['Enez', 'Havsa', 'İpsala', 'Keşan', 'Lalapaşa', 'Meriç', 'Süloğlu', 'Uzunköprü'],
  'Elazığ': ['Ağın', 'Alacakaya', 'Arıcak', 'Baskil', 'Karakoçan', 'Keban', 'Kovancılar', 'Maden', 'Palu', 'Sivrice'],
  Erzincan: ['Çayırlı', 'İliç', 'Kemah', 'Kemaliye', 'Otlukbeli', 'Refahiye', 'Tercan', 'Üzümlü'],
  Erzurum: ['Aşkale', 'Aziziye', 'Çat', 'Hınıs', 'Horasan', 'İspir', 'Karaçoban', 'Karayazı', 'Köprüköy', 'Narman', 'Oltu', 'Olur', 'Palandöken', 'Pasinler', 'Pazaryolu', 'Şenkaya', 'Tekman', 'Tortum', 'Uzundere', 'Yakutiye'],
  'Eskişehir': ['Alpu', 'Beylikova', 'Çifteler', 'Günyüzü', 'Han', 'İnönü', 'Mahmudiye', 'Mihalgazi', 'Mihalıççık', 'Odunpazarı', 'Sarıcakaya', 'Seyitgazi', 'Sivrihisar', 'Tepebaşı'],
  Gaziantep: ['Araban', 'İslahiye', 'Karkamış', 'Nizip', 'Nurdağı', 'Oğuzeli', 'Şahinbey', 'Şehitkamil', 'Yavuzeli'],
  Giresun: ['Alucra', 'Bulancak', 'Çamoluk', 'Çanakçı', 'Dereli', 'Doğankent', 'Espiye', 'Eynesil', 'Görele', 'Güce', 'Keşap', 'Piraziz', 'Şebinkarahisar', 'Tirebolu', 'Yağlıdere'],
  'Gümüşhane': ['Kelkit', 'Köse', 'Kürtün', 'Şiran', 'Torul'],
  Hakkari: ['Çukurca', 'Derecik', 'Şemdinli', 'Yüksekova'],
  Hatay: ['Altınözü', 'Antakya', 'Arsuz', 'Belen', 'Defne', 'Dörtyol', 'Erzin', 'Hassa', 'İskenderun', 'Kırıkhan', 'Kumlu', 'Payas', 'Reyhanlı', 'Samandağ', 'Yayladağı'],
  Isparta: ['Aksu', 'Atabey', 'Eğirdir', 'Gelendost', 'Gönen', 'Keçiborlu', 'Senirkent', 'Sütçüler', 'Şarkikaraağaç', 'Uluborlu', 'Yalvaç', 'Yenişarbademli'],
  Mersin: ['Akdeniz', 'Anamur', 'Aydıncık', 'Bozyazı', 'Çamlıyayla', 'Erdemli', 'Gülnar', 'Mezitli', 'Mut', 'Silifke', 'Tarsus', 'Toroslar', 'Yenişehir'],
  'İstanbul': ['Adalar', 'Arnavutköy', 'Ataşehir', 'Avcılar', 'Bağcılar', 'Bahçelievler', 'Bakırköy', 'Başakşehir', 'Bayrampaşa', 'Beşiktaş', 'Beykoz', 'Beylikdüzü', 'Beyoğlu', 'Büyükçekmece', 'Çatalca', 'Çekmeköy', 'Esenler', 'Esenyurt', 'Eyüpsultan', 'Fatih', 'Gaziosmanpaşa', 'Güngören', 'Kadıköy', 'Kağıthane', 'Kartal', 'Küçükçekmece', 'Maltepe', 'Pendik', 'Sancaktepe', 'Sarıyer', 'Silivri', 'Sultanbeyli', 'Sultangazi', 'Şile', 'Şişli', 'Tuzla', 'Ümraniye', 'Üsküdar', 'Zeytinburnu'],
  'İzmir': ['Aliağa', 'Balçova', 'Bayındır', 'Bayraklı', 'Bergama', 'Beydağ', 'Bornova', 'Buca', 'Çeşme', 'Çiğli', 'Dikili', 'Foça', 'Gaziemir', 'Güzelbahçe', 'Karabağlar', 'Karaburun', 'Karşıyaka', 'Kemalpaşa', 'Kınık', 'Kiraz', 'Konak', 'Menderes', 'Menemen', 'Narlıdere', 'Ödemiş', 'Seferihisar', 'Selçuk', 'Tire', 'Torbalı', 'Urla'],
  Kars: ['Akyaka', 'Arpaçay', 'Digor', 'Kağızman', 'Sarıkamış', 'Selim', 'Susuz'],
  Kastamonu: ['Abana', 'Ağlı', 'Araç', 'Azdavay', 'Bozkurt', 'Cide', 'Çatalzeytin', 'Daday', 'Devrekani', 'Doğanyurt', 'Hanönü', 'İhsangazi', 'İnebolu', 'Küre', 'Pınarbaşı', 'Seydiler', 'Şenpazar', 'Taşköprü', 'Tosya'],
  Kayseri: ['Akkışla', 'Bünyan', 'Develi', 'Felahiye', 'Hacılar', 'İncesu', 'Kocasinan', 'Melikgazi', 'Özvatan', 'Pınarbaşı', 'Sarıoğlan', 'Sarız', 'Talas', 'Tomarza', 'Yahyalı', 'Yeşilhisar'],
  'Kırklareli': ['Babaeski', 'Demirköy', 'Kofçaz', 'Lüleburgaz', 'Pehlivanköy', 'Pınarhisar', 'Vize'],
  'Kırşehir': ['Akçakent', 'Akpınar', 'Boztepe', 'Çiçekdağı', 'Kaman', 'Mucur'],
  Kocaeli: ['Başiskele', 'Çayırova', 'Darıca', 'Derince', 'Dilovası', 'Gebze', 'Gölcük', 'İzmit', 'Kandıra', 'Karamürsel', 'Kartepe', 'Körfez'],
  Konya: ['Ahırlı', 'Akören', 'Akşehir', 'Altınekin', 'Beyşehir', 'Bozkır', 'Cihanbeyli', 'Çeltik', 'Çumra', 'Derbent', 'Derebucak', 'Doğanhisar', 'Emirgazi', 'Ereğli', 'Güneysınır', 'Hadim', 'Halkapınar', 'Hüyük', 'Ilgın', 'Kadınhanı', 'Karapınar', 'Karatay', 'Kulu', 'Meram', 'Sarayönü', 'Selçuklu', 'Seydişehir', 'Taşkent', 'Tuzlukçu', 'Yalıhüyük', 'Yunak'],
  'Kütahya': ['Altıntaş', 'Aslanapa', 'Çavdarhisar', 'Domaniç', 'Dumlupınar', 'Emet', 'Gediz', 'Hisarcık', 'Pazarlar', 'Simav', 'Şaphane', 'Tavşanlı'],
  Malatya: ['Akçadağ', 'Arapgir', 'Arguvan', 'Battalgazi', 'Darende', 'Doğanşehir', 'Doğanyol', 'Hekimhan', 'Kale', 'Kuluncak', 'Pütürge', 'Yazıhan', 'Yeşilyurt'],
  Manisa: ['Ahmetli', 'Akhisar', 'Alaşehir', 'Demirci', 'Gölmarmara', 'Gördes', 'Kırkağaç', 'Köprübaşı', 'Kula', 'Salihli', 'Sarıgöl', 'Saruhanlı', 'Selendi', 'Soma', 'Şehzadeler', 'Turgutlu', 'Yunusemre'],
  'Kahramanmaraş': ['Afşin', 'Andırın', 'Çağlayancerit', 'Dulkadiroğlu', 'Ekinözü', 'Elbistan', 'Göksun', 'Nurhak', 'Onikişubat', 'Pazarcık', 'Türkoğlu'],
  Mardin: ['Artuklu', 'Dargeçit', 'Derik', 'Kızıltepe', 'Mazıdağı', 'Midyat', 'Nusaybin', 'Ömerli', 'Savur', 'Yeşilli'],
  'Muğla': ['Bodrum', 'Dalaman', 'Datça', 'Fethiye', 'Kavaklıdere', 'Köyceğiz', 'Marmaris', 'Menteşe', 'Milas', 'Ortaca', 'Seydikemer', 'Ula', 'Yatağan'],
  'Muş': ['Bulanık', 'Hasköy', 'Korkut', 'Malazgirt', 'Varto'],
  'Nevşehir': ['Acıgöl', 'Avanos', 'Derinkuyu', 'Gülşehir', 'Hacıbektaş', 'Kozaklı', 'Ürgüp'],
  'Niğde': ['Altunhisar', 'Bor', 'Çamardı', 'Çiftlik', 'Ulukışla'],
  Ordu: ['Akkuş', 'Altınordu', 'Aybastı', 'Çamaş', 'Çatalpınar', 'Çaybaşı', 'Fatsa', 'Gölköy', 'Gülyalı', 'Gürgentepe', 'İkizce', 'Kabadüz', 'Kabataş', 'Korgan', 'Kumru', 'Mesudiye', 'Perşembe', 'Ulubey', 'Ünye'],
  Rize: ['Ardeşen', 'Çamlıhemşin', 'Çayeli', 'Derepazarı', 'Fındıklı', 'Güneysu', 'Hemşin', 'İkizdere', 'İyidere', 'Kalkandere', 'Pazar'],
  Sakarya: ['Adapazarı', 'Akyazı', 'Arifiye', 'Erenler', 'Ferizli', 'Geyve', 'Hendek', 'Karapürçek', 'Karasu', 'Kaynarca', 'Kocaali', 'Pamukova', 'Sapanca', 'Serdivan', 'Söğütlü', 'Taraklı'],
  Samsun: ['Alaçam', 'Asarcık', 'Atakum', 'Ayvacık', 'Bafra', 'Canik', 'Çarşamba', 'Havza', 'İlkadım', 'Kavak', 'Ladik', 'Ondokuzmayıs', 'Salıpazarı', 'Tekkeköy', 'Terme', 'Vezirköprü', 'Yakakent'],
  Siirt: ['Baykan', 'Eruh', 'Kurtalan', 'Pervari', 'Şirvan', 'Tillo'],
  Sinop: ['Ayancık', 'Boyabat', 'Dikmen', 'Durağan', 'Erfelek', 'Gerze', 'Saraydüzü', 'Türkeli'],
  Sivas: ['Akıncılar', 'Altınyayla', 'Divriği', 'Doğanşar', 'Gemerek', 'Gölova', 'Gürün', 'Hafik', 'İmranlı', 'Kangal', 'Koyulhisar', 'Suşehri', 'Şarkışla', 'Ulaş', 'Yıldızeli', 'Zara'],
  'Tekirdağ': ['Çerkezköy', 'Çorlu', 'Ergene', 'Hayrabolu', 'Kapaklı', 'Malkara', 'Marmaraereğlisi', 'Muratlı', 'Saray', 'Süleymanpaşa', 'Şarköy'],
  Tokat: ['Almus', 'Artova', 'Başçiftlik', 'Erbaa', 'Niksar', 'Pazar', 'Reşadiye', 'Sulusaray', 'Turhal', 'Yeşilyurt', 'Zile'],
  Trabzon: ['Akçaabat', 'Araklı', 'Arsin', 'Beşikdüzü', 'Çarşıbaşı', 'Çaykara', 'Dernekpazarı', 'Düzköy', 'Hayrat', 'Köprübaşı', 'Maçka', 'Of', 'Ortahisar', 'Sürmene', 'Şalpazarı', 'Tonya', 'Vakfıkebir', 'Yomra'],
  Tunceli: ['Çemişgezek', 'Hozat', 'Mazgirt', 'Nazımiye', 'Ovacık', 'Pertek', 'Pülümür'],
  'Şanlıurfa': ['Akçakale', 'Birecik', 'Bozova', 'Ceylanpınar', 'Eyyübiye', 'Halfeti', 'Haliliye', 'Harran', 'Hilvan', 'Karaköprü', 'Siverek', 'Suruç', 'Viranşehir'],
  'Uşak': ['Banaz', 'Eşme', 'Karahallı', 'Sivaslı', 'Ulubey'],
  Van: ['Bahçesaray', 'Başkale', 'Çaldıran', 'Çatak', 'Edremit', 'Erciş', 'Gevaş', 'Gürpınar', 'İpekyolu', 'Muradiye', 'Özalp', 'Saray', 'Tuşba'],
  Yozgat: ['Akdağmadeni', 'Aydıncık', 'Boğazlıyan', 'Çandır', 'Çayıralan', 'Çekerek', 'Kadışehri', 'Saraykent', 'Sarıkaya', 'Sorgun', 'Şefaatli', 'Yenifakılı', 'Yerköy'],
  Zonguldak: ['Alaplı', 'Çaycuma', 'Devrek', 'Ereğli', 'Gökçebey', 'Kilimli', 'Kozlu'],
  Aksaray: ['Ağaçören', 'Eskil', 'Gülağaç', 'Güzelyurt', 'Ortaköy', 'Sarıyahşi', 'Sultanhanı'],
  Bayburt: ['Aydıntepe', 'Demirözü'],
  Karaman: ['Ayrancı', 'Başyayla', 'Ermenek', 'Kazımkarabekir', 'Sarıveliler'],
  'Kırıkkale': ['Bahşılı', 'Balışeyh', 'Çelebi', 'Delice', 'Karakeçili', 'Keskin', 'Sulakyurt', 'Yahşihan'],
  Batman: ['Beşiri', 'Gercüş', 'Hasankeyf', 'Kozluk', 'Sason'],
  'Şırnak': ['Beytüşşebap', 'Cizre', 'Güçlükonak', 'İdil', 'Silopi', 'Uludere'],
  'Bartın': ['Amasra', 'Kurucaşile', 'Ulus'],
  Ardahan: ['Çıldır', 'Damal', 'Göle', 'Hanak', 'Posof'],
  'Iğdır': ['Aralık', 'Karakoyunlu', 'Tuzluca'],
  Yalova: ['Altınova', 'Armutlu', 'Çınarcık', 'Çiftlikköy', 'Termal'],
  'Karabük': ['Eflani', 'Eskipazar', 'Ovacık', 'Safranbolu', 'Yenice'],
  Kilis: ['Elbeyli', 'Musabeyli', 'Polateli'],
  Osmaniye: ['Bahçe', 'Düziçi', 'Hasanbeyli', 'Kadirli', 'Sumbas', 'Toprakkale'],
  'Düzce': ['Akçakoca', 'Cumayeri', 'Çilimli', 'Gölyaka', 'Gümüşova', 'Kaynaşlı', 'Yığılca'],
}

/**
 * Tek başına konum sayılmayan ilçe adları: gündelik sözcük, kişi/kulüp/kurum adı veya Ankara'da da
 * semt adı olanlar. Bu ilçeler yalnız ilin kendisi de metinde geçiyorsa yazılır.
 */
const COMMON_DISTRICTS = new Set([
  'aksu', 'akdeniz', 'akpinar', 'altinordu', 'bagcilar', 'baglar', 'bahce', 'bahcelievler', 'besiktas', 'bor', 'boztepe', 'bozkurt',
  'cal', 'cat', 'carsamba', 'cay', 'cinar', 'ciftlik', 'demirci', 'derbent', 'dicle', 'efeler', 'emet', 'evciler', 'fatih', 'genc',
  'guney', 'hacilar', 'hamur', 'han', 'hani', 'hocalar', 'kale', 'kartal', 'karsiyaka', 'karatay', 'kas', 'kavak', 'kavaklidere',
  'kemer', 'kiraz', 'konak', 'korkut', 'kula', 'kulu', 'kumru', 'maden', 'maltepe', 'menderes', 'mut', 'nilufer', 'of', 'olur',
  'ondokuzmayis', 'orta', 'osmangazi', 'pamukkale', 'pazar', 'pazarlar', 'saray', 'selcuk', 'selcuklu', 'selim', 'sur', 'susuz',
  'taskent', 'termal', 'tire', 'toroslar', 'tut', 'ula', 'ulus', 'yenice', 'yildirim', 'yunusemre', 'zara', 'adalar', 'marmara',
  'belen', 'defne', 'derik', 'kozlu', 'gediz', 'soma', 'lice', 'kulp', 'baskil', 'palu', 'eskil', 'akoren', 'mucur', 'cide',
  'durağan', 'aralik', 'hassa', 'banaz', 'cumayeri', 'erenler', 'cankaya', 'esenler', 'sultangazi',
].map(fold))

/** Ankara'ya komşu iller (yakınlık puanında kısmi puan) */
export const ANKARA_NEIGHBOURS = ['Bolu', 'Çankırı', 'Kırıkkale', 'Kırşehir', 'Aksaray', 'Konya', 'Eskişehir']

/** Büyük iller (arama sorgularında Ankara'dan sonra) */
export const MAJOR_CITIES = ['İstanbul', 'İzmir', 'Bursa', 'Antalya', 'Konya', 'Kocaeli', 'Eskişehir', 'Kayseri', 'Gaziantep', 'Adana']

const ALIASES: Record<string, string> = {
  afyon: 'Afyonkarahisar', antep: 'Gaziantep', maras: 'Kahramanmaraş', urfa: 'Şanlıurfa', izmit: 'Kocaeli', icel: 'Mersin',
  kazan: 'Kahramankazan',
}

/** Başka anlamı olan adlar: yalnız Büyük harfle yazılmışsa ve düşük güvenle */
const AMBIGUOUS = new Set(['ordu', 'agri', 'van', 'mus', 'batman', 'bala', 'evren', 'cubuk', 'kazan', 'kars', 'mamak'])

/** Ardından gelirse yer adını sokak/cadde adına çeviren sözcükler */
const STREET_WORDS = ['cad', 'caddesi', 'cd', 'cadde', 'sok', 'sokak', 'sokagi', 'sk', 'bulvari', 'bulvar', 'blv', 'yolu', 'asfalti', 'mahallesi', 'mah', 'kapisi', 'garaji', 'otogari', 'lokantasi', 'firini', 'pasaji', 'apartmani', 'sitesi', 'kebap', 'kebapcisi', 'ekspres', 'treni']

const fp = new Map(PROVINCES.map((p) => [fold(p), p]))
const fd = new Map(ANKARA_DISTRICTS.map((d) => [fold(d), d]))

/** Katlanmış ilçe adı → { yazım, iller } (aynı adlı ilçeler birden çok ilde olabilir) */
const fdAll = new Map<string, { name: string; provinces: string[] }>()
for (const [prov, list] of Object.entries(DISTRICTS)) {
  for (const d of list) {
    const k = fold(d)
    const e = fdAll.get(k)
    if (e) e.provinces.push(prov)
    else fdAll.set(k, { name: d, provinces: [prov] })
  }
}

export interface GeoMatch {
  city: string | null
  district: string | null
  isAnkara: boolean
  /** 0–1 */
  confidence: number
  /** Eşleşen metin parçası (kaynaktaki yazımıyla) */
  matchedText: string | null
  /** Bulunan diğer iller (bilgi amaçlı) */
  others: string[]
}

interface Hit {
  name: string
  kind: 'il' | 'ilce'
  /** İlçe ise bulunduğu il(ler) */
  provinces: string[]
  pos: number
  text: string
  ambiguous: boolean
  explicit: boolean
  upper: boolean
}

function tokensWithOriginal(text: string): { orig: string; folded: string; base: string; pos: number }[] {
  const out: { orig: string; folded: string; base: string; pos: number }[] = []
  const re = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    const orig = m[0]
    const base = orig.split(/['’]/)[0]
    out.push({ orig, folded: fold(orig), base: fold(base), pos: i++ })
  }
  return out
}

function lookup<T>(map: Map<string, T>, tok: { folded: string; base: string }): T | null {
  if (map.has(tok.base)) return map.get(tok.base)!
  for (const [k, v] of map) if (k.length >= 4 && stemMatches(tok.folded, k)) return v
  return null
}

const EXPLICIT_AFTER = ['ili', 'ilinde', 'ilcesi', 'ilcesinde', 'ilcemizde', 'merkez', 'merkezde', 'belediyesi', 'belediyesince', 'valiligi', 'kaymakamligi', 'buyuksehir']

function scan(text: string): Hit[] {
  const toks = tokensWithOriginal(text)
  const hits: Hit[] = []
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]
    const next = toks[i + 1]?.folded ?? ''
    if (STREET_WORDS.includes(next) || /^(cad|sok|bulvar|yolu|asfalt)/.test(next)) continue
    let name: string | null = null
    let kind: 'il' | 'ilce' = 'il'
    let provinces: string[] = []
    const aliasKey = Object.keys(ALIASES).find((a) => t.base === a || (a.length >= 4 && stemMatches(t.folded, a)))
    const alias = aliasKey ? ALIASES[aliasKey] : undefined
    const d = lookup(fd, t)
    const p = lookup(fp, t)
    if (d && !p) {
      name = d
      kind = 'ilce'
      provinces = fdAll.get(fold(d))?.provinces ?? ['Ankara']
    } else if (p) {
      name = p
    } else if (alias) {
      name = alias
      kind = fd.has(fold(alias)) ? 'ilce' : 'il'
      if (kind === 'ilce') provinces = fdAll.get(fold(alias))?.provinces ?? ['Ankara']
    } else {
      const o = t.base.length >= 3 ? lookup(fdAll, t) : null
      if (o) {
        name = o.name
        kind = 'ilce'
        provinces = o.provinces
      }
    }
    if (!name) continue
    const upper = /^\p{Lu}/u.test(t.orig)
    const ambiguous = AMBIGUOUS.has(fold(name)) || AMBIGUOUS.has(t.base)
    if (ambiguous && !upper) continue
    if (!upper && t.base.length <= 4) continue
    // Ankara dışı ilçe adları yalnız Büyük harfle yazılmışsa (özel ad olarak) sayılır
    if (kind === 'ilce' && !provinces.includes('Ankara') && !upper) continue
    const after = toks[i + 1]?.folded ?? ''
    const explicit = /['’]/.test(t.orig) || EXPLICIT_AFTER.includes(after)
    hits.push({ name, kind, provinces, pos: t.pos, text: t.orig, ambiguous, explicit, upper })
  }
  return hits
}

/** İl geçmeden ilçe adından il çıkarılabilir mi: tek ilde, gündelik ad değil, Büyük harfle */
function distinctive(h: Hit): boolean {
  return h.kind === 'ilce' && h.upper && h.provinces.length === 1 && !COMMON_DISTRICTS.has(fold(h.name)) && fold(h.name).length >= 4
}

/** Metinden il/ilçe çıkarır. Önce başlık, sonra gövde değerlendirilir. */
export function detectLocation(title: string, body = ''): GeoMatch {
  const hits = [...scan(title).map((h) => ({ ...h, inTitle: true })), ...scan(body).map((h) => ({ ...h, inTitle: false }))]
  if (!hits.length) return { city: null, district: null, isAnkara: false, confidence: 0, matchedText: null, others: [] }
  const provinceHits = hits.filter((h) => h.kind === 'il')
  const districtHits = hits.filter((h) => h.kind === 'ilce')
  const provinces = [...new Set(provinceHits.map((h) => h.name))]
  const others = provinces.filter((p) => p !== 'Ankara')
  const ankaraDistricts = districtHits.filter((h) => h.provinces.includes('Ankara'))
  const result = (city: string, district: string | null, conf: number, matched: string): GeoMatch => ({
    city, district, isAnkara: city === 'Ankara', confidence: Math.max(0.2, Math.round(conf * 100) / 100), matchedText: matched, others: provinces.filter((x) => x !== city),
  })

  // 1) Ankara ilçesi ve metinde Ankara dışında il yok → Ankara (önceki davranış)
  if (ankaraDistricts.length && (provinces.includes('Ankara') || !others.length)) {
    const d = ankaraDistricts[0]
    const conf = d.ambiguous ? 0.5 : provinces.includes('Ankara') ? 0.95 : 0.85
    return { city: 'Ankara', district: d.name, isAnkara: true, confidence: conf, matchedText: d.text, others }
  }

  // 2) İl geçiyor: ilk uygun il (başlıktaki açık > başlıktaki > gövdedeki açık > gövdedeki); o ilin ilçesi varsa yazılır
  if (provinceHits.length) {
    // Bir ilçesi metinde geçen il, diğer illere tercih edilir ("Bornova Ankara Caddesi … İzmir")
    const paired = provinceHits.filter((p) => districtHits.some((d) => d.provinces.includes(p.name)))
    const pool = paired.length ? paired : provinceHits
    const pick = pool.find((h) => h.inTitle && h.explicit) ?? pool.find((h) => h.inTitle) ?? pool.find((h) => h.explicit) ?? pool[0]
    const d = districtHits.find((h) => h.provinces.includes(pick.name))
    if (d) return result(pick.name, d.name, d.ambiguous ? 0.6 : 0.9, d.text)
    // Ankara ilçesi + başka il ("Adıyaman Gölbaşı" ama ilçe o ilde değilse): il seçilir, ilçe boş
    let conf = ankaraDistricts.length ? 0.6 : pick.ambiguous ? 0.45 : pick.explicit ? 0.85 : 0.7
    if (provinces.length > 1) conf -= 0.15
    return result(pick.name, null, conf, pick.text)
  }

  // 3) Yalnız Ankara dışı ilçe adı: ayırt edici ise ilden çıkarım (düşük güven)
  const d = districtHits.find((h) => h.inTitle && distinctive(h)) ?? districtHits.find(distinctive)
  if (d) return result(d.provinces[0], d.name, d.explicit ? 0.7 : 0.6, d.text)
  return { city: null, district: null, isAnkara: false, confidence: 0, matchedText: null, others: [] }
}

/** Ankara yakınlığı (0–1): Ankara/ilçesi 1, komşu il 0.6, bilinen başka il 0.2, bilinmiyor 0.3 */
export function ankaraProximity(city: string | null): number {
  if (!city) return 0.3
  if (city === 'Ankara') return 1
  if (ANKARA_NEIGHBOURS.includes(city)) return 0.6
  return 0.2
}
