# LEONX CAD dönüştürme servisi
# - LibreDWG 0.13.3 (GPL-3.0) kaynaktan derlenir; tarball SHA-256 ve GNU anahtarlığıyla imza doğrulanır.
# - Çalışma imajı root olmayan kullanıcıyla, yalnız /tmp yazılabilir şekilde çalışacak biçimde hazırlanır.
# Çalıştırma önerisi (ağ çıkışı kapalı, salt okunur kök):
#   docker run --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
#     --memory 2g --pids-limit 128 -e SUPABASE_URL=... -e ALLOWED_USER_IDS=... -p 8080:8080 leonx-cad-worker
FROM debian:bookworm-slim AS libredwg
ARG LIBREDWG_VERSION=0.13.3
ARG LIBREDWG_SHA256=83f1f6e78a744777a481ff4520e4cef3f8ac4b2c1c25671077ca12fe81e8816e
ARG LIBREDWG_KEY=38A4167B0DB69E49C5F7216CB8C28866AB27A7A2
RUN apt-get update && apt-get install -y --no-install-recommends build-essential ca-certificates curl gnupg xz-utils \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl -fsSLO https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.xz \
 && curl -fsSLO https://github.com/LibreDWG/libredwg/releases/download/${LIBREDWG_VERSION}/libredwg-${LIBREDWG_VERSION}.tar.xz.sig \
 && echo "${LIBREDWG_SHA256}  libredwg-${LIBREDWG_VERSION}.tar.xz" | sha256sum -c - \
 && curl -fsSLO https://ftp.gnu.org/gnu/gnu-keyring.gpg \
 && gpgv --keyring ./gnu-keyring.gpg libredwg-${LIBREDWG_VERSION}.tar.xz.sig libredwg-${LIBREDWG_VERSION}.tar.xz \
 && tar xJf libredwg-${LIBREDWG_VERSION}.tar.xz
RUN cd libredwg-${LIBREDWG_VERSION} \
 && ./configure --prefix=/opt/libredwg --disable-bindings --disable-python --enable-release --disable-static \
 && make -j"$(nproc)" && make install \
 && cp -r test/test-data /opt/libredwg-testdata

FROM python:3.13-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    LIBREDWG_BIN=/opt/libredwg/bin LD_LIBRARY_PATH=/opt/libredwg/lib MPLCONFIGDIR=/tmp/mpl
COPY --from=libredwg /opt/libredwg /opt/libredwg
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd --system --uid 10001 --home /nonexistent cad
COPY leonx_cad ./leonx_cad
USER 10001
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/saglik', timeout=4)"
CMD ["uvicorn", "leonx_cad.app:create_app", "--factory", "--host", "0.0.0.0", "--port", "8080", "--limit-concurrency", "8", "--timeout-keep-alive", "5"]
