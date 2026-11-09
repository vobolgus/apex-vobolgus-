# One image, one service: the backend, with the frontend's static build inside it.
#
#   docker build -t skycharts .
#   docker run --rm -p 8080:8080 skycharts      # http://localhost:8080
#
# Railway builds this file as it is and sets PORT, which the backend listens on.

# --- The page: a static build (frontend/build), every file also packed as .br and .gz.
FROM node:22-bookworm-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# --- The server.
FROM rust:1-slim-bookworm AS backend
WORKDIR /app
COPY Cargo.toml Cargo.lock ./
COPY rust-core rust-core
COPY backend backend
RUN cargo build --release --locked -p backend

# --- What runs: the binary, the page and one font family.
FROM debian:bookworm-slim
# A chart with text (constellation names, the print footer) needs a font to set it
# in; without one the text is silently left out of the PDF.
RUN apt-get update \
	&& apt-get install -y --no-install-recommends fonts-dejavu-core \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=backend /app/target/release/backend /usr/local/bin/backend
COPY --from=frontend /app/frontend/build /srv/static
ENV STATIC_DIR=/srv/static
# glibc's allocator, told to give memory back. A large document is some 100 MB while
# it is converted; by default a good part of that stays with the process afterwards
# (30-70 MB measured, against 6 MB idle), and memory is billed for as long as it is
# held. With two arenas and the trim and mmap thresholds pinned at 128 KB it settles
# at about 22 MB, at the same speed. Setting the thresholds also switches off their
# automatic growth, which is what kept the freed blocks.
ENV MALLOC_ARENA_MAX=2 \
	MALLOC_TRIM_THRESHOLD_=131072 \
	MALLOC_MMAP_THRESHOLD_=131072
USER nobody
EXPOSE 8080
CMD ["backend"]
