#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { SPRITE_MANIFEST, VOICE_LINES, SFX_CLIPS } from '../src/game/core/assetManifest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const useDist = process.argv.includes('--dist');
const requireVersion = process.argv.includes('--require-version');
const assetRoot = path.join(root, useDist ? 'dist/assets' : 'public/assets');
const sourceRoot = path.join(root, 'src');

const errors = [];

function fail(message) {
  errors.push(message);
}

function exists(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function walk(dir, predicate = () => true) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, predicate));
    else if (predicate(full, entry)) out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file);
}

function visibleAssetFiles(dir, exts) {
  return walk(dir, (file) => {
    const name = path.basename(file);
    if (name.startsWith('.')) return false;
    return exts.has(path.extname(name).toLowerCase());
  });
}

function assertUniqueValues(name, entries) {
  const seen = new Map();
  for (const [key, value] of entries) {
    if (seen.has(value)) fail(`${name} file "${value}" is used by both "${seen.get(value)}" and "${key}"`);
    seen.set(value, key);
  }
}

function validateManifestFiles() {
  const spriteEntries = Object.entries(SPRITE_MANIFEST);
  const voiceEntries = VOICE_LINES.map((name) => [name, `${name}.wav`]);
  assertUniqueValues('Sprite manifest', spriteEntries);
  assertUniqueValues('Voice manifest', voiceEntries);

  const spriteDir = path.join(assetRoot, 'sprites');
  const voiceDir = path.join(assetRoot, 'voice');
  for (const [key, filename] of spriteEntries) {
    const file = path.join(spriteDir, filename);
    if (!exists(file)) fail(`Sprite "${key}" points to missing file ${rel(file)}`);
  }
  for (const [key, filename] of voiceEntries) {
    const file = path.join(voiceDir, filename);
    if (!exists(file)) fail(`Voice line "${key}" points to missing file ${rel(file)}`);
  }

  const manifestSpriteFiles = new Set(spriteEntries.map(([, filename]) => filename));
  for (const file of visibleAssetFiles(spriteDir, new Set(['.png', '.jpg', '.jpeg', '.webp']))) {
    const filename = path.basename(file);
    if (!manifestSpriteFiles.has(filename)) fail(`Sprite file ${rel(file)} is not listed in SPRITE_MANIFEST`);
  }

  const manifestVoiceFiles = new Set(voiceEntries.map(([, filename]) => filename));
  for (const file of visibleAssetFiles(voiceDir, new Set(['.wav', '.mp3', '.ogg', '.m4a']))) {
    const filename = path.basename(file);
    if (!manifestVoiceFiles.has(filename)) fail(`Voice file ${rel(file)} is not listed in VOICE_LINES`);
  }

  const sfxEntries = SFX_CLIPS.map((name) => [name, `${name}.mp3`]);
  assertUniqueValues('Sfx manifest', sfxEntries);
  const sfxDir = path.join(assetRoot, 'sfx');
  for (const [key, filename] of sfxEntries) {
    const file = path.join(sfxDir, filename);
    if (!exists(file)) fail(`Sfx clip "${key}" points to missing file ${rel(file)}`);
  }
  const manifestSfxFiles = new Set(sfxEntries.map(([, filename]) => filename));
  for (const file of visibleAssetFiles(sfxDir, new Set(['.wav', '.mp3', '.ogg', '.m4a']))) {
    const filename = path.basename(file);
    if (!manifestSfxFiles.has(filename)) fail(`Sfx file ${rel(file)} is not listed in SFX_CLIPS`);
  }
}

function jsSourceFiles() {
  return walk(sourceRoot, (file) => file.endsWith('.js'));
}

function collectRegexMatches(regex, text, file, kind) {
  const matches = [];
  for (const match of text.matchAll(regex)) {
    matches.push({ value: match[1], file, kind });
  }
  return matches;
}

function validateSourceReferences() {
  const spriteKeys = new Set(Object.keys(SPRITE_MANIFEST));
  const voiceKeys = new Set(VOICE_LINES);
  const sfxKeys = new Set(SFX_CLIPS);
  const spriteRefs = [];
  const voiceRefs = [];
  const sfxRefs = [];

  for (const file of jsSourceFiles()) {
    const text = fs.readFileSync(file, 'utf8');
    spriteRefs.push(...collectRegexMatches(/\bassets\.get(?:Tinted)?\(\s*['"]([A-Za-z0-9_-]+)['"]/g, text, file, 'asset'));
    spriteRefs.push(...collectRegexMatches(/\b(?:game|g|this)\.assets\.get(?:Tinted)?\(\s*['"]([A-Za-z0-9_-]+)['"]/g, text, file, 'asset'));
    spriteRefs.push(...collectRegexMatches(/\bsprite:\s*['"]([A-Za-z0-9_-]+)['"]/g, text, file, 'sprite'));
    for (const call of text.matchAll(/\bsfx\.play\(([^;\n]*)\)/g)) {
      const args = call[1] ?? '';
      for (const literal of args.matchAll(/['"]([a-z0-9_]+)['"]/g)) {
        sfxRefs.push({ value: literal[1], file, kind: 'sfx' });
      }
    }

    for (const call of text.matchAll(/\b(?:this\.)?say\(([^;\n]*)\)/g)) {
      const args = call[1] ?? '';
      for (const literal of args.matchAll(/['"]([a-z0-9_]+)['"]/g)) {
        voiceRefs.push({ value: literal[1], file, kind: 'voice' });
      }
    }
    for (const call of text.matchAll(/\b(?:g|game|this)\.say\(([^;\n]*)\)/g)) {
      const args = call[1] ?? '';
      for (const literal of args.matchAll(/['"]([a-z0-9_]+)['"]/g)) {
        voiceRefs.push({ value: literal[1], file, kind: 'voice' });
      }
    }
  }

  for (const ref of spriteRefs) {
    if (!spriteKeys.has(ref.value)) fail(`Source references unknown sprite "${ref.value}" in ${rel(ref.file)}`);
  }
  for (const ref of voiceRefs) {
    if (!voiceKeys.has(ref.value)) fail(`Source references unknown voice line "${ref.value}" in ${rel(ref.file)}`);
  }
  for (const ref of sfxRefs) {
    if (!sfxKeys.has(ref.value)) fail(`Source references unknown sfx clip "${ref.value}" in ${rel(ref.file)}`);
  }
}

function validateVoiceGenerator() {
  const script = path.join(root, 'scripts/gen_voice.py');
  if (!exists(script)) return;
  const text = fs.readFileSync(script, 'utf8');
  const block = text.match(/LINES\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const generated = new Set([...block.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));
  const manifest = new Set(VOICE_LINES);
  for (const name of manifest) {
    if (!generated.has(name)) fail(`scripts/gen_voice.py is missing voice line "${name}"`);
  }
  for (const name of generated) {
    if (!manifest.has(name)) fail(`scripts/gen_voice.py has extra voice line "${name}" not listed in VOICE_LINES`);
  }
}

function validateDistVersion() {
  if (!useDist || !requireVersion) return;
  const versionFile = path.join(root, 'dist/version.json');
  if (!exists(versionFile)) {
    fail('dist/version.json is missing');
    return;
  }
  try {
    const data = JSON.parse(fs.readFileSync(versionFile, 'utf8'));
    if (typeof data.version !== 'string' || data.version.length < 7) fail('dist/version.json has an invalid version');
    if (typeof data.builtAt !== 'string' || !data.builtAt) fail('dist/version.json has an invalid builtAt');
  } catch (error) {
    fail(`dist/version.json is not valid JSON: ${error.message}`);
  }
}

function validateSfxGenerator() {
  const script = path.join(root, 'scripts/gen_sfx.py');
  if (!exists(script)) return;
  const text = fs.readFileSync(script, 'utf8');
  const block = text.match(/SFX\s*=\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
  const generated = new Set([...block.matchAll(/^\s*"([^"]+)":/gm)].map((match) => match[1]));
  const manifest = new Set(SFX_CLIPS);
  for (const name of manifest) {
    if (!generated.has(name)) fail(`scripts/gen_sfx.py is missing sfx clip "${name}"`);
  }
  for (const name of generated) {
    if (!manifest.has(name)) fail(`scripts/gen_sfx.py has extra sfx clip "${name}" not listed in SFX_CLIPS`);
  }
}

validateManifestFiles();
if (!useDist) {
  validateSourceReferences();
  validateVoiceGenerator();
  validateSfxGenerator();
}
validateDistVersion();

if (errors.length) {
  console.error(`Asset validation failed for ${useDist ? 'dist' : 'source'}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(`Asset validation passed for ${useDist ? 'dist' : 'source'}.`);
