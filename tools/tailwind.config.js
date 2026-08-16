/** @type {import('tailwindcss').Config} */
// Lifted verbatim from the inline `tailwind.config` that used to sit in
// index.html and feed the Play CDN's in-browser compiler. Same tokens, same
// values — the only additions are `content` (which files to scan for class
// names) and the forms plugin, which the CDN URL used to request as
// `?plugins=forms`.
module.exports = {
    // Scanned for class names. app.js builds markup in template strings, so it
    // matters as much as the HTML; web/vendor/ is third-party and excluded.
    content: ["../web/index.html", "../web/app.js", "../web/patterns.js"],
    plugins: [require("@tailwindcss/forms")],
    darkMode: "class",
    theme: { extend: {
      colors: {
        "on-primary-container":"#00285d","on-background":"#dae2fd","on-primary-fixed-variant":"#004395",
        "surface-container-low":"#131b2e","on-secondary-fixed-variant":"#2f2ebe","on-tertiary-fixed":"#311400",
        "error-container":"#93000a","inverse-surface":"#dae2fd","secondary-container":"#3131c0","on-primary":"#002e6a",
        "surface-variant":"#2d3449","surface-tint":"#adc6ff","surface-container-lowest":"#060e20","tertiary":"#ffb786",
        "surface-container":"#171f33","primary-fixed":"#d8e2ff","on-secondary-fixed":"#07006c","on-tertiary-container":"#461f00",
        "surface":"#0b1326","on-error":"#690005","on-primary-fixed":"#001a42","surface-dim":"#0b1326",
        "surface-container-high":"#222a3d","on-tertiary-fixed-variant":"#723600","background":"#0b1326","on-tertiary":"#502400",
        "on-secondary-container":"#b0b2ff","primary":"#adc6ff","secondary-fixed":"#e1e0ff","tertiary-fixed":"#ffdcc6",
        "on-surface":"#dae2fd","primary-fixed-dim":"#adc6ff","outline-variant":"#424754","outline":"#8c909f",
        "secondary-fixed-dim":"#c0c1ff","tertiary-container":"#df7412","secondary":"#c0c1ff","on-secondary":"#1000a9",
        "on-surface-variant":"#c2c6d6","error":"#ffb4ab","surface-bright":"#31394d","inverse-primary":"#005ac2",
        "tertiary-fixed-dim":"#ffb786","inverse-on-surface":"#283044","primary-container":"#4d8eff",
        "surface-container-highest":"#2d3449","on-error-container":"#ffdad6","success":"#8fd98f"
      },
      borderRadius:{ "DEFAULT":"0.125rem","lg":"0.25rem","xl":"0.5rem","full":"9999px" },
      spacing:{ "gutter":"16px","stack-gap":"12px","sidebar-width":"260px","container-padding":"24px","unit":"4px" },
      /* Text comes from the machine, not from us: the branded faces are named
         first so anyone who has them installed still gets them, then the
         platform's own UI and monospace stacks. Nothing is downloaded, and
         nothing has to be vendored, for any of this. */
      fontFamily:{
        "display":["Geist","system-ui","-apple-system","Segoe UI","Roboto","Helvetica Neue","Arial","sans-serif"],
        "body":["Inter","system-ui","-apple-system","Segoe UI","Roboto","Helvetica Neue","Arial","sans-serif"],
        "code":["JetBrains Mono","ui-monospace","SFMono-Regular","SF Mono","Menlo","Consolas","Liberation Mono","monospace"],
        "label":["JetBrains Mono","ui-monospace","SFMono-Regular","SF Mono","Menlo","Consolas","Liberation Mono","monospace"]
      },
    }},
  };
