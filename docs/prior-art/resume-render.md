# Prior-Art Note: Print-CSS Template & Headless Chrome Container Config (D16 / D44 / D69)

## 1. Print-CSS Template Choice

For ATS-safe resume rendering, we deliberately choose a **single, deterministic print-CSS template**:

- **Single-column vertical flow**: Multi-column layouts confuse older ATS parsers and text extraction engines (like `pdftotext` or `pdfjs`), interleaving columns into unreadable text streams.
- **Semantic HTML hierarchy**: Standard headings (`<h1>`, `<h2>`), paragraph text (`<p>`), and clean inline lists (`<span>`, `<ul>`). No layout tables, no text-in-canvas, and no text-in-images.
- **CSS Variables for the Fit Budget**: Font size (`--font-size`), line height (`--line-height`), and page margins (`--margin`) are controlled via CSS custom properties on `@page` and `:root`. This enables the deterministic typographic shrink (ladder step 2) to scale layout dimensions without modifying any user content.
- **Standard System Typography**: System serif/sans-serif fonts (`Helvetica, Arial, sans-serif` or `Times New Roman, serif`) ensure reproducible metrics across host and container environments without requiring external web font network requests.

## 2. Headless Chrome Container Configuration

Running headless Chrome inside container environments (Docker / Railway / Render) requires specific flags to avoid sandbox, shared memory, and GPU crashes:

- `--headless=new` or `--headless`: Headless rendering mode.
- `--no-sandbox`: Mandatory in unprivileged container environments without seccomp bpf capabilities.
- `--disable-gpu`: Eliminates hardware acceleration overhead and prevents shader cache disk writes.
- `--disable-dev-shm-usage`: Disables `/dev/shm` shared memory usage, writing temporary buffers to `/tmp` instead (prevents container crashes on environments with 64MB `/dev/shm` limits).
- `--print-to-pdf`: Directly outputs PDF bytes to stdout or a temporary file.

### Graceful Fallback Strategy

In environments where Chrome binary installation is prohibited or unavailable (e.g. constrained test environments), the system provides a deterministic fallback PDF generator (`buildSimplePdfBuffer` in `src/lib/pdf-utils.ts`) that outputs valid PDF 1.4 byte streams. This preserves test suite speed and reliability while testing the exact same storage, signing, and self-lint pipelines.
