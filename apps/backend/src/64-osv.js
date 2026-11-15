const OSV_SNAPSHOT_META = { source: "OSV / GHSA curated", snapshot: "2026-09", note: "Offline advisory snapshot; extend or override per project via .wide/osv.json" };

const OSV_SNAPSHOT = {
  npm: [
    { name: "handlebars", lt: "4.7.7", id: "CVE-2021-23369", cwe: "CWE-1336", sev: "high", note: "remote code execution via the compiler when compiling templates from untrusted input" },
    { name: "ws", lt: "7.4.6", id: "CVE-2021-32640", cwe: "CWE-1333", sev: "medium", note: "ReDoS when parsing crafted Sec-WebSocket-Protocol headers" },
    { name: "async", lt: "2.6.4", id: "CVE-2021-43138", cwe: "CWE-1321", sev: "high", note: "prototype pollution in the mapValues() helper" },
    { name: "json5", lt: "2.2.2", id: "CVE-2022-46175", cwe: "CWE-1321", sev: "high", note: "prototype pollution via __proto__ when parsing" },
    { name: "minimatch", lt: "3.0.5", id: "CVE-2022-3517", cwe: "CWE-1333", sev: "high", note: "ReDoS in brace-expansion / glob parsing" },
    { name: "word-wrap", lt: "1.2.4", id: "CVE-2023-26115", cwe: "CWE-1333", sev: "medium", note: "ReDoS on long inputs without whitespace" },
    { name: "tough-cookie", lt: "4.1.3", id: "CVE-2023-26136", cwe: "CWE-1321", sev: "medium", note: "prototype pollution in cookie memstore" },
    { name: "follow-redirects", lt: "1.15.4", id: "CVE-2023-26159", cwe: "CWE-601", sev: "medium", note: "improper URL handling allows following a malformed location" },
    { name: "express", lt: "4.19.2", id: "CVE-2024-29041", cwe: "CWE-601", sev: "medium", note: "open redirect via a malformed URL passed to res.location/redirect" },
    { name: "braces", lt: "3.0.3", id: "CVE-2024-4068", cwe: "CWE-400", sev: "high", note: "uncontrolled resource consumption on crafted brace patterns" },
    { name: "micromatch", lt: "4.0.8", id: "CVE-2024-4067", cwe: "CWE-1333", sev: "medium", note: "ReDoS in the pattern parser" },
    { name: "y18n", lt: "4.0.1", id: "CVE-2020-7774", cwe: "CWE-1321", sev: "high", note: "prototype pollution via the locale setter" },
    { name: "qs", lt: "6.5.3", id: "CVE-2022-24999", cwe: "CWE-1321", sev: "high", note: "prototype pollution / DoS when parsing crafted query strings" },
    { name: "@astrojs/node", lt: "11.1.11", id: "CVE-2026-126364", cwe: "CWE-22", sev: "medium", note: "Astro: Image endpoint in @astrojs/node can read files from a case-variant sibling of the output directory on case-sensitive filesystems" },
    { name: "@astrojs/solid-js", ge: "0.2.0", lt: "7.1.2", id: "CVE-2026-126363", cwe: "CWE-79", sev: "low", note: "Astro: Reflected XSS via unescaped slot names in @astrojs/solid-js" },
    { name: "@astrojs/svelte", ge: "5.7.3", lt: "9.1.2", id: "CVE-2026-126362", cwe: "CWE-79", sev: "low", note: "Astro: Reflected XSS via unescaped slot names in @astrojs/svelte" },
    { name: "@grpc/grpc-js-xds", lt: "1.13.2", id: "CVE-2026-126367", cwe: "CWE-625", sev: "medium", note: "@grpc/grpc-js: safe_regex incorrectly applies partial string matching for patterns with alternation" },
    { name: "@grpc/grpc-js-xds", ge: "1.14.0", lt: "1.14.2", id: "CVE-2026-126367", cwe: "CWE-625", sev: "medium", note: "@grpc/grpc-js: safe_regex incorrectly applies partial string matching for patterns with alternation" },
    { name: "@grpc/grpc-js-xds", ge: "1.14.0", lt: "1.14.2", id: "CVE-2026-128065", cwe: "CWE-863", sev: "medium", note: "@grpc/grpc-js: RBAC override configs in VirtualHost and Route resources are not applied" },
    { name: "@hono/node-server", lt: "1.19.18", id: "CVE-2026-126210", cwe: "CWE-436", sev: "medium", note: "@hono/node-server: Backslash in the request path is parsed as a path separator, bypassing path-based access control at a reverse proxy" },
    { name: "@hono/node-server", ge: "2.0.0", lt: "2.1.6", id: "CVE-2026-126210", cwe: "CWE-436", sev: "medium", note: "@hono/node-server: Backslash in the request path is parsed as a path separator, bypassing path-based access control at a reverse proxy" },
    { name: "@hono/node-server", ge: "2.0.0", lt: "2.1.6", id: "CVE-2026-126343", cwe: "CWE-248", sev: "medium", note: "@hono/node-server: Unhandled ECONNRESET on the socket during an asynchronous WebSocket upgrade crashes the process" },
    { name: "@nuxt/nitro-server", ge: "4.6.0", lt: "4.6.4", id: "CVE-2026-128077", cwe: "CWE-436", sev: "medium", note: "Nuxt: a leading double slash in the request path bypasses server middleware path checks and route rules on page routes" },
    { name: "@nuxt/schema", ge: "3.5.0", lt: "4.6.4", id: "CVE-2026-128070", cwe: "CWE-552", sev: "medium", note: "Nuxt dev server serves files from a parent directory with a stray lockfile or workspace file" },
    { name: "@opentelemetry/instrumentation-http", ge: "0.204.0", lt: "0.222.0", id: "CVE-2026-128080", cwe: "CWE-200", sev: "medium", note: "OpenTelemetry JavaScript: Sensitive Information exposure in @opentelemetry/instrumentation-http" },
    { name: "@sveltejs/adapter-cloudflare", ge: "4.7.0", lt: "7.2.10", id: "CVE-2026-128122", cwe: "CWE-79", sev: "medium", note: "SvelteKit: Prerendered redirect paths can inject arbitrary rules into _redirects generated by @sveltejs/adapter-cloudflare" },
    { name: "@sveltejs/adapter-cloudflare", ge: "8.0.0-next.0", lt: "8.0.2", id: "CVE-2026-128122", cwe: "CWE-79", sev: "medium", note: "SvelteKit: Prerendered redirect paths can inject arbitrary rules into _redirects generated by @sveltejs/adapter-cloudflare" },
    { name: "@sveltejs/adapter-node", ge: "5.5.7", lt: "5.5.8", id: "CVE-2026-128123", cwe: "CWE-248", sev: "medium", note: "SvelteKit: @sveltejs/adapter-node crashes when proxying certain requests via fetch" },
    { name: "@sveltejs/adapter-node", ge: "6.0.0-next.0", lt: "6.0.1", id: "CVE-2026-128123", cwe: "CWE-248", sev: "medium", note: "SvelteKit: @sveltejs/adapter-node crashes when proxying certain requests via fetch" },
    { name: "@sveltejs/adapter-static", lt: "3.0.11", id: "CVE-2026-128121", cwe: "CWE-116", sev: "medium", note: "SvelteKit: Prerendered paths are interpreted as regular expressions in Vercel route config" },
    { name: "@sveltejs/adapter-static", ge: "4.0.0-next.0", lt: "4.0.1", id: "CVE-2026-128121", cwe: "CWE-116", sev: "medium", note: "SvelteKit: Prerendered paths are interpreted as regular expressions in Vercel route config" },
    { name: "@sveltejs/adapter-vercel", lt: "6.3.5", id: "CVE-2026-128121", cwe: "CWE-116", sev: "medium", note: "SvelteKit: Prerendered paths are interpreted as regular expressions in Vercel route config" },
    { name: "@sveltejs/adapter-vercel", ge: "7.0.0-next.0", lt: "7.0.2", id: "CVE-2026-128121", cwe: "CWE-116", sev: "medium", note: "SvelteKit: Prerendered paths are interpreted as regular expressions in Vercel route config" },
    { name: "@sveltejs/kit", lt: "2.70.4", id: "CVE-2026-128117", cwe: "CWE-248", sev: "medium", note: "SvelteKit: adapter-node crashes with an unhandled URIError when reroute rewrites malformed pathnames" },
    { name: "@sveltejs/kit", ge: "3.0.0", lt: "3.1.1", id: "CVE-2026-128117", cwe: "CWE-248", sev: "medium", note: "SvelteKit: adapter-node crashes with an unhandled URIError when reroute rewrites malformed pathnames" },
    { name: "ag-psd", lt: "31.0.0", id: "CVE-2026-62297", cwe: "CWE-789", sev: "high", note: "ag-psd can exhaust memory when parsing crafted PSD dimensions" },
    { name: "astro", lt: "7.4.5", id: "CVE-2026-126361", cwe: "CWE-79", sev: "low", note: "Astro: XSS via attribute injection in dynamic tag names" },
    { name: "astro", ge: "5.14.3", lt: "7.4.7", id: "CVE-2026-126364", cwe: "CWE-22", sev: "medium", note: "Astro: Image endpoint in @astrojs/node can read files from a case-variant sibling of the output directory" },
    { name: "basic-ftp", lt: "6.2.4", id: "CVE-2026-126345", cwe: "CWE-248", sev: "medium", note: "basic-ftp: Uncaught TypeError in MLSD directory-listing parser via __proto__ fact name causes DoS in Client.list()" },
    { name: "basic-ftp", lt: "6.2.3", id: "CVE-2026-126346", cwe: "CWE-248", sev: "medium", note: "basic-ftp: Uncaught exception crashes the Node.js process when a password or download path contains CR/LF" },
    { name: "hono", lt: "4.13.16", id: "CVE-2026-126355", cwe: "CWE-352", sev: "medium", note: "Hono: csrf() does not check requests sent by hyperlink auditing (text/ping)" },
    { name: "hono", ge: "4.5.1", lt: "4.13.16", id: "CVE-2026-126356", cwe: "CWE-20", sev: "medium", note: "Hono: validator(form) skips validation for multipart/form-data requests with extra parameters" },
    { name: "hono", lt: "4.13.16", id: "CVE-2026-126357", cwe: "CWE-288", sev: "medium", note: "Hono: mount() and app.mount() can forward a path that bypasses middleware scoped inside the mount prefix" },
    { name: "hono", ge: "4.1.4", lt: "4.13.16", id: "CVE-2026-126358", cwe: "CWE-863", sev: "medium", note: "Hono: RegExpRouter skips wildcard middleware for some route sets and paths with an encoded line terminator" },
    { name: "hono", ge: "3.12.0", lt: "4.13.16", id: "CVE-2026-126359", cwe: "CWE-79", sev: "low", note: "Hono: css helper does not escape a closing tag split between the template and an interpolated value" },
  ],
  pip: [
    { name: "flask", lt: "2.2.5", id: "CVE-2023-30861", cwe: "CWE-539", sev: "high", note: "cached response may leak a session cookie to the wrong client" },
    { name: "werkzeug", lt: "2.2.3", id: "CVE-2023-25577", cwe: "CWE-400", sev: "high", note: "denial of service via many multipart form parts" },
    { name: "urllib3", lt: "1.26.5", id: "CVE-2021-33503", cwe: "CWE-1333", sev: "high", note: "ReDoS when parsing crafted URLs" },
    { name: "pillow", lt: "9.0.1", id: "CVE-2022-22817", cwe: "CWE-94", sev: "critical", note: "arbitrary expression evaluation in PIL.ImageMath.eval" },
    { name: "setuptools", lt: "65.5.1", id: "CVE-2022-40897", cwe: "CWE-1333", sev: "high", note: "ReDoS in package_index when scanning a crafted index page" },
    { name: "cryptography", lt: "3.3.2", id: "CVE-2020-36242", cwe: "CWE-787", sev: "high", note: "buffer overflow when decrypting very large ciphertexts with Fernet/HKDF" },
    { name: "dnspython", lt: "2.9.2", id: "CVE-2026-128089", cwe: "CWE-400", sev: "high", note: "dnspython has excessive memory and CPU use" },
    { name: "envd", ge: "0.3.38", lt: "1.3.6", id: "CVE-2026-128079", cwe: "CWE-22", sev: "medium", note: "envd: Host file disclosure through requirements path traversal and TOCTOU" },
    { name: "nltk", ge: "3.10.0", lt: "3.10.4", id: "CVE-2026-126295", cwe: "CWE-22", sev: "medium", note: "NLTK: BllipParser passes caller-supplied model paths to the bllipparser C extension with no pathsec check" },
    { name: "nltk", lt: "3.10.4", id: "CVE-2026-126297", cwe: "CWE-400", sev: "high", note: "NLTK: Quadratic-time CPU denial of service in ConllCorpusReader SRL instance builder" },
    { name: "nltk", lt: "3.10.4", id: "CVE-2026-126298", cwe: "CWE-400", sev: "high", note: "NLTK: Quadratic-time CPU denial of service in Tree.chomsky_normal_form right-factor binarization" },
    { name: "nltk", lt: "3.10.4", id: "CVE-2026-126299", cwe: "CWE-400", sev: "high", note: "NLTK: Quadratic-time CPU denial of service in CCG lexicon parser" },
    { name: "nltk", ge: "3.2.5", lt: "3.10.4", id: "CVE-2026-126300", cwe: "CWE-400", sev: "medium", note: "NLTK: Quadratic CPU exhaustion in TreebankWordTokenizer.span_tokenize" },
    { name: "nltk", lt: "3.10.4", id: "CVE-2026-126303", cwe: "CWE-400", sev: "high", note: "NLTK: Unbounded CPU consumption in SteppingRecursiveDescentParser.parse()" },
    { name: "nltk", ge: "3.10.0", lt: "3.10.4", id: "CVE-2026-126304", cwe: "CWE-59", sev: "high", note: "NLTK: Symlink escape in YCOECorpusReader lets a psd/pos directory symlink read outside corpus root" },
    { name: "nltk", lt: "3.10.3", id: "GHSA-4hvg-fv5c-9936", cwe: "CWE-400", sev: "high", note: "NLTK SteppingRecursiveDescentParser.parse() unbounded CPU consumption" },
    { name: "nltk", lt: "3.10.4", id: "GHSA-6665-2vj3-h76r", cwe: "CWE-400", sev: "high", note: "NLTK Tree.chomsky_normal_form quadratic-time CPU DoS" },
    { name: "nltk", lt: "3.10.4", id: "GHSA-7r4r-6ppg-7ff8", cwe: "CWE-59", sev: "high", note: "NLTK YCOECorpusReader symlink escape" },
    { name: "nltk", lt: "3.10.4", id: "GHSA-f7j6-hf97-9v99", cwe: "CWE-22", sev: "high", note: "NLTK BllipParser unvalidated model path traversal" },
    { name: "nltk", lt: "3.10.4", id: "GHSA-g5wx-957h-f4wj", cwe: "CWE-73", sev: "medium", note: "NLTK path traversal in save_maxent_params / load_maxent_params" },
    { name: "nltk", ge: "3.6", lt: "3.10.4", id: "GHSA-gpwc-27cw-rh9r", cwe: "CWE-400", sev: "medium", note: "NLTK: Quadratic CPU exhaustion in LegalitySyllableTokenizer.tokenize" },
    { name: "nltk", lt: "3.10.4", id: "GHSA-jh6r-h4rx-2j3w", cwe: "CWE-400", sev: "high", note: "NLTK CCG lexicon parser quadratic-time CPU DoS" },
    { name: "nltk", lt: "3.10.4", id: "GHSA-qvhx-rvgc-jhwf", cwe: "CWE-400", sev: "high", note: "NLTK ConllCorpusReader SRL quadratic-time CPU DoS" },
    { name: "nltk", lt: "3.10.4", id: "GHSA-rg32-vgf9-927c", cwe: "CWE-407", sev: "medium", note: "NLTK TreebankWordTokenizer.span_tokenize quadratic CPU exhaustion" },
    { name: "nova", ge: "18.0.0", lt: "31.3.0", id: "CVE-2026-46448", cwe: "CWE-669", sev: "medium", note: "OpenStack Nova: scheduler hint injection bypasses Placement resource claims" },
    { name: "nova", ge: "32.0.0", lt: "32.2.1", id: "CVE-2026-46448", cwe: "CWE-669", sev: "medium", note: "OpenStack Nova: scheduler hint injection bypasses Placement resource claims" },
    { name: "nova", ge: "33.0.0", lt: "33.0.2", id: "CVE-2026-46448", cwe: "CWE-669", sev: "medium", note: "OpenStack Nova: scheduler hint injection bypasses Placement resource claims" },
    { name: "opentelemetry-api", lt: "1.45.2", id: "CVE-2026-126360", cwe: "CWE-1333", sev: "medium", note: "OpenTelemetry Python API: Denial of service through quadratic-time traceparent parsing" },
    { name: "Pillow", lt: "13.0.0", id: "CVE-2026-128066", cwe: "CWE-770", sev: "medium", note: "Pillow: Memory DoS in TIFF and EXIF IFD parsing via overlapping tag data" },
    { name: "Pillow", lt: "13.0.0", id: "CVE-2026-128067", cwe: "CWE-787", sev: "high", note: "Pillow: Heap buffer overflow saving TIFF with libtiff when tags override image size" },
    { name: "rucio", ge: "1.14.0.post1", lt: "35.9.1", id: "CVE-2026-100397", cwe: "CWE-287", sev: "critical", note: "Rucio: Unauthenticated administrator impersonation through SSH challenge tokens" },
    { name: "rucio", ge: "36.0.0rc1", lt: "38.6.1", id: "CVE-2026-100397", cwe: "CWE-287", sev: "critical", note: "Rucio: Unauthenticated administrator impersonation through SSH challenge tokens" },
    { name: "rucio", ge: "39.0.0rc1", lt: "40.4.2", id: "CVE-2026-100397", cwe: "CWE-287", sev: "critical", note: "Rucio: Unauthenticated administrator impersonation through SSH challenge tokens" },
    { name: "rucio", ge: "41.0.0rc1", lt: "41.1.1", id: "CVE-2026-100397", cwe: "CWE-287", sev: "critical", note: "Rucio: Unauthenticated administrator impersonation through SSH challenge tokens" },
    { name: "soupsieve", lt: "4.0.0", id: "CVE-2026-126190", cwe: "CWE-407", sev: "high", note: "Soup Sieve: Polynomial-time denial of service in the descendant combinator" },
    { name: "soupsieve", lt: "3.0.2", id: "CVE-2026-126191", cwe: "CWE-1333", sev: "high", note: "Soup Sieve: Exponential ReDoS in selector compilation" },
    { name: "soupsieve", lt: "2.10.0", id: "CVE-2026-126192", cwe: "CWE-400", sev: "medium", note: "Soup Sieve: General sibling combinator inside :has() matches untrusted HTML in quadratic time" },
    { name: "soupsieve", ge: "0.4", lt: "3.0.2", id: "CVE-2026-126193", cwe: "CWE-674", sev: "medium", note: "Soup Sieve: Uncontrolled recursion in CSS parser lets nested pseudo-class selectors exhaust call stack" },
    { name: "tornado", lt: "6.6.1", id: "CVE-2026-126347", cwe: "CWE-601", sev: "low", note: "Tornado: Open redirect via triple-slash redirect paths" },
  ],
  maven: [
    { name: "snakeyaml", lt: "2.0", id: "CVE-2022-1471", cwe: "CWE-502", sev: "high", note: "remote code execution via the default constructor when loading untrusted YAML" },
    { name: "spring-beans", ge: "5.3.0", lt: "5.3.18", id: "CVE-2022-22965", cwe: "CWE-94", sev: "critical", note: "Spring4Shell — data-binding remote code execution" },
    { name: "jackson-databind", ge: "2.0.0", lt: "2.12.7", id: "CVE-2020-36518", cwe: "CWE-787", sev: "high", note: "denial of service via deeply nested JSON" },
    { name: "commons-collections", lt: "3.2.2", id: "CVE-2015-6420", cwe: "CWE-502", sev: "high", note: "remote code execution via unsafe deserialization gadget chains" },
    { name: "guava", ge: "1.0", lt: "32.0.0", id: "CVE-2023-2976", cwe: "CWE-379", sev: "medium", note: "local information disclosure via world-readable temporary directories" },
    { name: "httpclient", lt: "4.5.13", id: "CVE-2020-13956", cwe: "CWE-644", sev: "medium", note: "improper URI parsing can mislead request routing" },
  ],
  go: [
    { name: "golang.org/x/net", lt: "0.17.0", id: "CVE-2023-39325", cwe: "CWE-400", sev: "high", note: "HTTP/2 rapid reset denial of service" },
    { name: "golang.org/x/crypto", lt: "0.17.0", id: "CVE-2023-48795", cwe: "CWE-222", sev: "medium", note: "Terrapin — SSH transcript truncation weakens the handshake" },
    { name: "github.com/gin-gonic/gin", lt: "1.9.1", id: "CVE-2023-29401", cwe: "CWE-494", sev: "medium", note: "unsafe filename handling in Context.FileAttachment" },
    { name: "github.com/filebrowser/filebrowser/v2", lt: "2.63.17", id: "CVE-2026-62683", cwe: "CWE-863", sev: "low", note: "File Browser: Trailing-slash directory deletion leaves public shares active for recreated paths" },
    { name: "github.com/pgEdge/control-plane", lt: "0.11.0", id: "CVE-2026-125323", cwe: "CWE-306", sev: "high", note: "pgEdge Control Plane generates pg_hba.conf with trust authentication for local and loopback connections" },
    { name: "github.com/pgEdge/pgedge-rag-server", lt: "1.0.1-0.20260729022402-72e0785a6d7c", id: "CVE-2026-125326", cwe: "CWE-209", sev: "medium", note: "pgEdge RAG Server discloses configured provider credential fractions in API error messages" },
    { name: "github.com/pgEdge/pgedge-rag-server", lt: "1.0.1-0.20260729020411-a09d4872356b", id: "CVE-2026-125327", cwe: "CWE-405", sev: "high", note: "pgEdge RAG Server unbounded corpus read allows resource exhaustion from unauthenticated requests" },
    { name: "github.com/strukturag/libheif", lt: "1.15.2", id: "CVE-2023-29659", cwe: "CWE-369", sev: "medium", note: "libheif vulnerable to segmentation fault via floating point exception" },
    { name: "go.opentelemetry.io/otel/baggage", ge: "1.0.0-RC1", lt: "1.47.0", id: "CVE-2026-128086", cwe: "CWE-400", sev: "medium", note: "OpenTelemetry-Go: Eager W3C baggage-property materialization causes memory amplification" },
    { name: "go.opentelemetry.io/otel/propagation", ge: "1.0.0-RC1", lt: "1.47.0", id: "CVE-2026-128086", cwe: "CWE-400", sev: "medium", note: "OpenTelemetry-Go: Eager W3C baggage-property materialization causes memory amplification" },
    { name: "go.opentelemetry.io/otel/sdk", ge: "1.33.0", lt: "1.47.0", id: "CVE-2026-128085", cwe: "CWE-135", sev: "medium", note: "opentelemetry-go: AttributeValueLengthLimit bypassed by U+FFFD runes" },
    { name: "go.opentelemetry.io/otel/sdk/log", ge: "0.9.0", lt: "1.47.0", id: "CVE-2026-128085", cwe: "CWE-135", sev: "medium", note: "opentelemetry-go: AttributeValueLengthLimit bypassed by U+FFFD runes" },
    { name: "go.opentelemetry.io/otel/trace", ge: "1.35.0", lt: "1.47.0", id: "CVE-2026-128085", cwe: "CWE-135", sev: "medium", note: "opentelemetry-go: AttributeValueLengthLimit bypassed by U+FFFD runes" },
  ],
};

function osvFilePath(root) {
  return node_path.join(root, ".wide", "osv.json");
}

function osvCountEntries(doc) {
  if (!doc || typeof doc !== "object") return 0;
  if (Array.isArray(doc)) return doc.length;
  if (Array.isArray(doc.entries)) return doc.entries.length;
  if (Array.isArray(doc.vulns)) return doc.vulns.length;
  let n = 0;
  for (const eco of ["npm", "pip", "maven", "go", "cargo", "nuget", "composer", "rubygems"]) {
    if (Array.isArray(doc[eco])) n += doc[eco].length;
  }
  return n;
}

function osvCollectFromScanner(doc) {
  const out = [];
  const results = doc && Array.isArray(doc.results) ? doc.results : [];
  for (const result of results) {
    const packages = result && Array.isArray(result.packages) ? result.packages : [];
    for (const pkg of packages) {
      const vulns = pkg && Array.isArray(pkg.vulnerabilities) ? pkg.vulnerabilities : [];
      for (const vuln of vulns) if (vuln && typeof vuln === "object") out.push(vuln);
    }
  }
  return out;
}

function osvCollectFromAny(doc) {
  if (Array.isArray(doc)) return doc;
  if (doc && Array.isArray(doc.results)) return osvCollectFromScanner(doc);
  if (doc && Array.isArray(doc.entries)) return doc.entries;
  if (doc && Array.isArray(doc.vulns)) return doc.vulns;
  return [];
}

function runOsvScanner(root) {
  return new Promise((resolve) => {
    const win = process.platform === "win32";
    const args = ["--format", "json", "-r", "."];
    let child;
    try {
      if (win) {
        child = node_child_process.spawn(["osv-scanner", ...args].join(" "), { cwd: root, shell: true, windowsHide: true });
      } else {
        child = node_child_process.spawn("osv-scanner", args, { cwd: root, windowsHide: true });
      }
    } catch (error) {
      resolve({ output: "", error: String((error && error.message) || error) });
      return;
    }
    let output = "";
    let err = "";
    child.stdout.on("data", (c) => { if (output.length < 8 * 1024 * 1024) output += c.toString("utf8"); });
    child.stderr.on("data", (c) => { if (err.length < 65536) err += c.toString("utf8"); });
    child.on("error", (error) => resolve({ output, error: String((error && error.message) || error) }));
    child.on("close", () => resolve({ output, error: err }));
  });
}

function registerOsvHandlers() {
  electron.ipcMain.handle("osv:info", async (_event, root) => {
    if (!root || typeof root !== "string") return { ok: false };
    try {
      const raw = await promises.readFile(osvFilePath(root), "utf8");
      const doc = JSON.parse(raw);
      let updatedAt = doc && doc.updatedAt ? doc.updatedAt : null;
      if (!updatedAt) {
        const stat = await promises.stat(osvFilePath(root));
        updatedAt = new Date(stat.mtimeMs).toISOString();
      }
      return { ok: true, exists: true, updatedAt, count: osvCountEntries(doc) };
    } catch {
      return { ok: true, exists: false };
    }
  });

  electron.ipcMain.handle("osv:refresh", async (_event, root, dumpPath) => {
    if (!root || typeof root !== "string") return { ok: false, error: "No project." };
    let entries = [];
    if (dumpPath && typeof dumpPath === "string") {
      try {
        entries = osvCollectFromAny(JSON.parse(await promises.readFile(dumpPath, "utf8")));
      } catch {
        return { ok: false, error: "That OSV dump could not be read." };
      }
    } else {
      const res = await runOsvScanner(root);
      try {
        entries = osvCollectFromScanner(JSON.parse(res.output));
      } catch {
        return { ok: false, error: res.error && /ENOENT|not recognized|not found/i.test(res.error) ? "osv-scanner is not installed or not on PATH." : "osv-scanner produced no readable JSON." };
      }
    }
    const doc = { tool: "osv-scanner", updatedAt: new Date().toISOString(), entries };
    try {
      await promises.mkdir(node_path.join(root, ".wide"), { recursive: true });
      await promises.writeFile(osvFilePath(root), JSON.stringify(doc, null, 2), "utf8");
    } catch (error) {
      return { ok: false, error: String((error && error.message) || error) };
    }
    return { ok: true, count: entries.length };
  });
}
