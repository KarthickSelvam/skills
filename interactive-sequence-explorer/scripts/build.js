#!/usr/bin/env node
// Inlines the template and a flow data folder into one self-contained HTML file.
// Usage: node build.js <flow-dir-or-file> [out.html]
"use strict";
const fs = require("fs"), path = require("path");
const { loadFlow, validate } = require("./validate.js");

const target = process.argv[2];
if (!target) { console.error("Usage: node build.js <flow-dir-or-file> [out.html]"); process.exit(2); }
const src = path.resolve(target);
const out = path.resolve(process.argv[3] || path.join(path.dirname(src), "index.html"));

const { flow, sources } = loadFlow(src);
const { errors, warnings } = validate(flow);
warnings.forEach(w => console.log("warn  " + w));
if (errors.length) { errors.forEach(e => console.log("ERROR " + e)); process.exit(1); }

const tpl = p => fs.readFileSync(path.join(__dirname, "..", "template", p), "utf8");
const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
// Keep "</script>" inside data from closing the inline script element.
const data = sources.join("\n").replace(/<\/script/gi, "<\\/script");
const html = tpl("shell.html")
  .replace("/*__TITLE__*/", () => esc(flow.meta.title))
  .replace("/*__CSS__*/", () => tpl("style.css"))
  .replace("/*__DATA__*/", () => data)
  .replace("/*__APP__*/", () => tpl("app.js"));
fs.writeFileSync(out, html);
console.log(`${out} (${Math.round(html.length / 1024)} KB)`);
