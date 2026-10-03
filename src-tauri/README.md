# Prism Browser (Servo Edition)

Prism is a native Rust desktop app using [Servo](https://servo.org/) for web
rendering and [egui](https://www.egui.rs/) for browser chrome. Servo is an
independent engine, not Chromium, WebView2, or Electron. The legacy Electron
app remains in the source tree while browser features are ported; it is not the
entry point for the Prism build.

## Build on Windows

This project is a native Rust app using [Servo](https://servo.org/), an
independent browser engine. Servo embeds native C/C++ code, so a working
compiler, resource compiler, Windows SDK, and link.exe are required for a
standard MSVC build. Visual Studio C++ Build Tools is the usual Windows setup,
but it is not installed automatically by this project and may require
administrator rights. If you cannot install MSVC tooling, an alternative is a
portable cross-compilation setup with [cargo-xwin](https://github.com/messense/cargo-xwin)
using a prebuilt LLVM/Clang toolchain and a Windows sysroot installed in your
user profile; that path is optional and not required by this repository.

Set `LIBCLANG_PATH` to the folder containing Clang's `libclang.dll` when
bindgen cannot locate it.

Run from the repository root:

```powershell
cargo run --manifest-path src-tauri/Cargo.toml
```

Or use `npm start` after installing Rust and putting Cargo on `PATH`.
`cargo build --release --manifest-path src-tauri/Cargo.toml` creates an
unpackaged native executable under `src-tauri/target/release/`.

Servo is an experimental engine. This browser is an early single-window
prototype and not yet a feature-complete replacement: Chromium extensions,
the previous encrypted profile format, many legacy settings and browser
features, media/GPU integrations, and distributable packaging remain to be
ported and verified. The prototype uses software rendering, which is slow and
is not intended as the final presentation backend. Existing Electron packages
in the project root are obsolete; do not distribute them as Prism builds.
