# Lisans envanteri — CAD dönüştürme servisi

| Bileşen | Sürüm | Lisans | Kullanım biçimi |
| --- | --- | --- | --- |
| GNU LibreDWG (`dwg2dxf`, `dwgread`) | 0.13.3 | GPL-3.0-or-later | Ayrı program olarak alt süreçte çağrılır; servis koduna bağlanmaz (link edilmez). Kaynak: https://github.com/LibreDWG/libredwg |
| ezdxf | 1.4.4 | MIT | DXF doğrulama, envanter, PDF çizimi |
| matplotlib | 3.11.2 | Matplotlib License (PSF tabanlı, BSD uyumlu) | PDF önizleme |
| numpy | 2.5.4 | BSD-3-Clause | matplotlib/ezdxf bağımlılığı |
| pillow | 12.3.0 | MIT-CMU (HPND) | matplotlib bağımlılığı |
| FastAPI | 0.143.2 | MIT | HTTP servisi |
| Starlette | 1.8.0 | BSD-3-Clause | FastAPI bağımlılığı |
| Uvicorn | 0.54.0 | BSD-3-Clause | HTTP sunucusu |
| python-multipart | 0.0.32 | Apache-2.0 | Dosya yükleme |
| PyJWT (+ cryptography) | 2.15.1 / 50.0.2 | MIT / Apache-2.0 veya BSD-3-Clause | Supabase oturum belirteci doğrulama |

**Kullanılmayanlar ve nedeni:**
- PyMuPDF: AGPL-3.0 veya ücretli ticari lisans gerektiriyor.
- ODA File Converter: kullanım koşulları bu geliştirme ortamından doğrulanamadı; ticari kullanım için üyelik gerektirdiği belirtiliyor.
- Autodesk APS: ücretli bulut hizmeti; çizimler üçüncü tarafa gider.

**GPL notu:** LibreDWG ikilisi imajla birlikte dağıtılırsa (ör. imaj başkalarına verilirse) GPL-3.0 gereği LibreDWG'nin kaynak koduna erişim sağlanmalıdır. Kaynak, imajın derlendiği resmî sürüm paketidir: `libredwg-0.13.3.tar.xz` (SHA-256 Dockerfile'da). Servisin kendi kodu LibreDWG'ye bağlanmadığı için GPL kapsamına girmez.

Güvenlik taraması: `pip-audit -r requirements.txt` CI'da her çalıştırmada; 2026-10-16 itibarıyla bilinen açık yok.
