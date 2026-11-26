# Builds tippecanoe (>= 2.17 can write .pmtiles directly) so nothing has to be installed on Windows.
FROM debian:bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential git ca-certificates libsqlite3-dev zlib1g-dev && rm -rf /var/lib/apt/lists/*
RUN git clone --depth 1 --branch 2.72.0 https://github.com/felt/tippecanoe.git /src \
 && make -C /src -j"$(nproc)" && make -C /src install PREFIX=/opt/tippecanoe

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libsqlite3-0 zlib1g libstdc++6 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /opt/tippecanoe/bin/ /usr/local/bin/
WORKDIR /work
ENTRYPOINT ["tippecanoe"]
