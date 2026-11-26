## Linked size

From one build (tools/build.py default (debug: -O2 -g), x86_64 Linux): text and data of each native object by the library its source comes from, and of each
Silk function by its module, without debug information. Every native object is linked today, so this is what a
build without the capability would drop, at most.

| C library | Service | KiB |
| --- | --- | ---: |
| built-in JavaScript source | Core and every service | 11,159.6 |
| OpenSSL | Crypto, Tls | 4,817.7 |
| SQLite | Database | 2,545.0 |
| brotli | Compression | 857.7 |
| zstd | Compression | 688.2 |
| WAMR | Wasm | 505.7 |
| libuv | Platform | 182.9 |
| nghttp2 | Http2 | 170.6 |
| zlib | Compression | 92.6 |
| llhttp | Http | 51.2 |
| inspector transport | Inspector | 21.6 |
| runtime C | Core | 0.8 |

| Silk code | KiB |
| --- | ---: |
| Engine | 16,411.7 |
| Silk standard library | 3,083.7 |
| Core | 1,024.5 |
| Executable | 747.4 |
| Network | 443.2 |
| Inspector | 407.2 |
| Wasm | 300.2 |
| Workers | 254.2 |
| Database | 151.8 |
| Files | 123.0 |
| Processes | 122.9 |
| NativeAddons | 108.6 |
| SystemInfo | 98.1 |
| Crypto | 78.5 |
| Tls | 57.0 |
| Http | 49.3 |
| Http2 | 33.0 |
| Compression | 26.7 |

| File | MiB |
| --- | ---: |
| Built-in bytecode | 21.1 |
| Heap image | 42.9 |
| Executable | 202.1 |

