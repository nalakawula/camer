"use strict";

// Common Caddyfile patterns, adapted from the Caddy documentation
// ("Common Caddyfile Patterns"). Clicking one inserts its snippet into the
// editor. Paths use the `root * <path>` matcher form so snippets adapt cleanly.
window.CADDY_PATTERNS = [
  {
    name: "Static file server",
    desc: "Serve files from a directory",
    code: "example.com {\n\troot * /var/www\n\tfile_server\n}\n",
  },
  {
    name: "Reverse proxy",
    desc: "Proxy all requests to a backend",
    code: "example.com {\n\treverse_proxy localhost:5000\n}\n",
  },
  {
    name: "Reverse proxy + static",
    desc: "Proxy /api/*, serve files for the rest",
    code: "example.com {\n\troot * /var/www\n\treverse_proxy /api/* localhost:5000\n\tfile_server\n}\n",
  },
  {
    name: "PHP (PHP-FPM)",
    desc: "Modern PHP app via FastCGI",
    code: "example.com {\n\troot * /srv/public\n\tencode\n\tphp_fastcgi localhost:9000\n\tfile_server\n}\n",
  },
  {
    name: "PHP (FrankenPHP)",
    desc: "PHP embedded in Caddy",
    code: "{\n\tfrankenphp\n\torder php_server before file_server\n}\n\nexample.com {\n\troot * /srv/public\n\tencode zstd br gzip\n\tphp_server\n}\n",
  },
  {
    name: "Redirect www → apex",
    desc: "Remove the www. subdomain",
    code: "www.example.com {\n\tredir https://example.com{uri}\n}\n\nexample.com {\n}\n",
  },
  {
    name: "Redirect apex → www",
    desc: "Add the www. subdomain",
    code: "example.com {\n\tredir https://www.{host}{uri}\n}\n\nwww.example.com {\n}\n",
  },
  {
    name: "Trailing slashes",
    desc: "Enforce slashes with rewrite",
    code: "example.com {\n\trewrite /add     /add/\n\trewrite /remove/ /remove\n}\n",
  },
  {
    name: "Wildcard certificate",
    desc: "ACME DNS challenge for *.domain",
    code: "*.example.com {\n\ttls {\n\t\tdns <provider_name> [<params...>]\n\t}\n\tabort\n}\n\n# This will use the above certificate\nfoo.example.com {\n\trespond \"Foo!\"\n}\n",
  },
  {
    name: "Single-page app (SPA)",
    desc: "try_files fallback to index.html",
    code: "example.com {\n\troot * /srv\n\tencode\n\ttry_files {path} /index.html\n\tfile_server\n}\n",
  },
  {
    name: "SPA + API",
    desc: "handle /api/* separately",
    code: "example.com {\n\tencode\n\n\thandle /api/* {\n\t\treverse_proxy backend:8000\n\t}\n\n\thandle {\n\t\troot * /srv\n\t\ttry_files {path} /index.html\n\t\tfile_server\n\t}\n}\n",
  },
  {
    name: "Caddy → Caddy (front)",
    desc: "Public instance proxying inward",
    code: "foo.example.com, bar.example.com {\n\treverse_proxy 10.0.0.1:80\n}\n",
  },
  {
    name: "Caddy → Caddy (back)",
    desc: "Private instance behind a proxy",
    code: "{\n\tservers {\n\t\ttrusted_proxies static private_ranges\n\t}\n}\n\nhttp://foo.example.com {\n\treverse_proxy foo-app:8080\n}\n\nhttp://bar.example.com {\n\treverse_proxy bar-app:9000\n}\n",
  },
];
