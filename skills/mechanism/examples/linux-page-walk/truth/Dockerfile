# flowcast linux probe image: glibc userland for the Linux 7.0.14 (linuxkit, arm64) figures
FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential strace linux-perf gdb binutils procps util-linux python3 file \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
