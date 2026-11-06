#!/usr/bin/env node
// Validates a flow data folder (or a single .js file) against reference/data-schema.md.
// Usage: node validate.js <flow-dir-or-file>
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm");

const KINDS = ["request", "response", "async", "internal", "failure"];
const LANGS = ["json", "sql", "http", "text"];

function loadFlow(target) {
  const files = fs.statSync(target).isDirectory()
    ? fs.readdirSync(target).filter(f => f.endsWith(".js")).sort().map(f => path.join(target, f))
    : [target];
  if (!files.length) throw new Error("No .js data files in " + target);
  const ctx = {}; ctx.window = ctx; vm.createContext(ctx);
  const sources = files.map(f => fs.readFileSync(f, "utf8"));
  sources.forEach((src, i) => vm.runInContext(src, ctx, { filename: files[i] }));
  if (!ctx.FLOW) throw new Error("Data files must assign window.FLOW");
  return { flow: ctx.FLOW, sources, files };
}

function validate(flow) {
  const errors = [], warnings = [];
  const err = m => errors.push(m), warn = m => warnings.push(m);
  if (!flow.meta || !flow.meta.title) err("meta.title is required");
  if (!flow.lanes || !Object.keys(flow.lanes).length) err("lanes is required");
  if (!flow.seqs || !Object.keys(flow.seqs).length) err("seqs is required");
  if (errors.length) return { errors, warnings };

  for (const [id, L] of Object.entries(flow.lanes)) {
    if (!/^[a-z][a-z0-9_-]*$/.test(id)) err(`lane id "${id}" must be lowercase letters, digits, - or _`);
    for (const f of ["name", "kind", "plain"]) if (!L[f]) err(`lane ${id}: missing ${f}`);
    if (L.kind && !L.kindPlain && /lambda|aws|sql|api|sdk|http|queue|s3|-/i.test(L.kind)) warn(`lane ${id}: kind "${L.kind}" looks technical; add kindPlain`);
  }

  const ids = new Set(), codes = new Set();
  for (const [key, S] of Object.entries(flow.seqs)) {
    const where = `seq ${key}`;
    if (!S.code || String(S.code).length !== 1) err(`${where}: code must be one character`);
    else {
      const c = String(S.code).toLowerCase();
      if (c === "t") err(`${where}: code T is reserved for the Plain/Technical toggle`);
      if (codes.has(c)) err(`${where}: duplicate code ${S.code}`);
      codes.add(c);
    }
    if (!S.title) err(`${where}: missing title`);
    if (!Array.isArray(S.lanes) || !S.lanes.length) { err(`${where}: lanes must be a non-empty array`); continue; }
    S.lanes.forEach(l => { if (!flow.lanes[l]) err(`${where}: unknown lane ${l}`); });
    if (!Array.isArray(S.steps) || !S.steps.length) { err(`${where}: steps must be a non-empty array`); continue; }
    const base = S.steps.filter(s => !s.alt);
    if (base.length > 24) warn(`${where}: ${base.length} main steps; consider splitting into two sequences (8-20 reads best)`);
    const used = new Set();
    for (const s of S.steps) {
      const w = `${where} step ${s.id || "?"}`;
      if (!s.id || !/^[A-Za-z0-9_-]+$/.test(s.id)) err(`${w}: id must be letters, digits, - or _`);
      else if (ids.has(s.id)) err(`${w}: duplicate step id (ids must be unique across all sequences)`);
      ids.add(s.id);
      for (const f of ["title", "story", "label"]) if (!s[f]) err(`${w}: missing ${f}`);
      if (!Array.isArray(s.route) || !s.route.length) { err(`${w}: route must be a non-empty array of lane ids`); continue; }
      s.route.forEach(l => { if (!S.lanes.includes(l)) err(`${w}: route lane ${l} is not in ${where}.lanes`); used.add(l); });
      if (s.kind && !KINDS.includes(s.kind)) err(`${w}: kind must be one of ${KINDS.join(", ")}`);
      if (s.alt && !S.steps.some(x => x.id === s.after && !x.alt)) err(`${w}: alt step needs "after" pointing at a main step id`);
      if (s.kind === "failure" && !s.alt) warn(`${w}: failure steps are usually alt branches (alt: true, after: <id>)`);
      for (const k of ["req", "res"]) if (s[k]) {
        if (!LANGS.includes(s[k].lang)) err(`${w}: ${k}.lang must be one of ${LANGS.join(", ")}`);
        if (typeof s[k].body !== "string") err(`${w}: ${k}.body must be a string`);
      }
      if (s.label && s.label.length > 16) warn(`${w}: label "${s.label}" is long for the train (max ~16 chars)`);
      if (s.label && !s.labelPlain && /[A-Z][a-z]+[A-Z]|[._/]|^[A-Z]{2,}/.test(s.label)) warn(`${w}: label "${s.label}" looks technical; add labelPlain`);
      const rt = s.roundTrip === true || (s.roundTrip !== false && !!s.res && s.route.length > 1 && !["response", "failure"].includes(s.kind));
      if (rt && !s.resLabel) warn(`${w}: round trip without resLabel; the reply train will read "reply"`);
      if (s.call && (!s.call.verb || !s.call.text)) err(`${w}: call needs verb and text`);
      for (const t of s.tables || []) {
        if (!t.name) err(`${w}: table entry without name`);
        if (!t.op) warn(`${w}: table ${t.name} has no op (READ, INSERT, UPDATE, UPSERT, DELETE)`);
        if (!t.sql) warn(`${w}: table ${t.name} has no sql; every table touched should show its statement`);
      }
      const storeHit = s.route.some(l => flow.lanes[l] && flow.lanes[l].store);
      if (storeHit && !(s.tables && s.tables.length) && s.kind !== "internal") warn(`${w}: touches a data store but lists no tables`);
      if (s.story && s.story.length > 320) warn(`${w}: story is ${s.story.length} chars; keep it to one or two plain sentences`);
    }
    S.lanes.forEach(l => { if (!used.has(l)) warn(`${where}: lane ${l} is never used by a step`); });
  }
  return { errors, warnings };
}

module.exports = { loadFlow, validate };

if (require.main === module) {
  const target = process.argv[2];
  if (!target) { console.error("Usage: node validate.js <flow-dir-or-file>"); process.exit(2); }
  const { flow } = loadFlow(path.resolve(target));
  const { errors, warnings } = validate(flow);
  warnings.forEach(w => console.log("warn  " + w));
  errors.forEach(e => console.log("ERROR " + e));
  const n = Object.values(flow.seqs).reduce((a, s) => a + s.steps.length, 0);
  console.log(`${Object.keys(flow.seqs).length} sequences, ${n} steps, ${Object.keys(flow.lanes).length} lanes: ${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
