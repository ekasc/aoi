#!/usr/bin/env node
/**
 * Static accessibility audit for the Aoi app.
 *
 * Walks every .tsx file under app/ and components/ and reports JSX elements
 * that are interactive or meaningful but missing the accessibility props a
 * screen reader needs. This is intentionally conservative: it only flags
 * elements where the fix is unambiguous, so a clean run is a real signal.
 *
 * Usage:
 *   node scripts/a11y-audit.mjs            # human-readable report
 *   node scripts/a11y-audit.mjs --json     # machine-readable
 *   node scripts/a11y-audit.mjs --strict   # exit 1 when findings exist
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Resolve the repo root from this file's URL when running as a script; fall
// back to the working directory when a bundler rewrites import.meta.url.
const ROOT = (() => {
  try {
    return fileURLToPath(new URL('..', import.meta.url));
  } catch {
    return process.cwd();
  }
})();
const SCAN_DIRS = ['app', 'components'];
const IGNORE_DIRS = new Set(['node_modules', '.expo', 'dist', 'ios', 'android']);

// Elements that are tappable and therefore need a role + a name.
const INTERACTIVE = new Set([
  'Pressable',
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableWithoutFeedback',
  'TouchableNativeFeedback',
]);

// Elements that render media and need a label or an explicit decorative mark.
const MEDIA = new Set(['Image', 'ImageBackground', 'FastImage']);

// Elements that accept text and need an accessible name.
const INPUTS = new Set(['TextInput']);

// Toggle/range controls need an accessible name.
const TOGGLES = new Set(['Switch', 'Slider']);

// Props that satisfy each requirement.
const HAS_LABEL = new Set([
  'accessibilityLabel',
  'aria-label',
  'alt',
  'accessibilityLabelledBy',
  'aria-labelledby',
]);
const HAS_ROLE = new Set(['accessibilityRole', 'role']);
const DECORATIVE = new Set([
  'accessible',
  'accessibilityElementsHidden',
  'importantForAccessibility',
  'aria-hidden',
]);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (IGNORE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) walk(full, out);
    else if (entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function attrName(node) {
  if (!ts.isJsxAttribute(node)) return null;
  return node.name.getText();
}

function hasAttr(attrs, names) {
  return attrs.some((a) => {
    const name = attrName(a);
    return name !== null && names.has(name);
  });
}

// True when any JSX element in the subtree carries one of the named props.
function subtreeHasAttr(node, name) {
  let found = false;
  function visit(child) {
    if (found) return;
    if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
      const attrs = child.attributes.properties.filter(ts.isJsxAttribute);
      if (hasAttr(attrs, new Set([name]))) {
        found = true;
        return;
      }
    }
    ts.forEachChild(child, visit);
  }
  ts.forEachChild(node, visit);
  return found;
}

function attrValue(attrs, name) {
  const attr = attrs.find((a) => attrName(a) === name);
  if (!attr || !attr.initializer) return undefined;
  if (ts.isStringLiteral(attr.initializer)) return attr.initializer.text;
  if (ts.isJsxExpression(attr.initializer) && attr.initializer.expression) {
    const expr = attr.initializer.expression;
    if (ts.isStringLiteral(expr)) return expr.text;
    if (expr.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (expr.kind === ts.SyntaxKind.TrueKeyword) return true;
  }
  return undefined;
}

function hasTextChild(node) {
  if (!node.children) return false;
  return node.children.some((child) => {
    if (ts.isJsxText(child)) return child.text.trim().length > 0;
    if (ts.isJsxExpression(child) && child.expression) {
      // A non-empty expression child (e.g. {label}) counts as a name source.
      return true;
    }
    // A nested element (e.g. <ThemedText>{label}</ThemedText>) may render the
    // accessible name, so recurse into it.
    if (ts.isJsxElement(child)) return hasTextChild(child);
    if (ts.isJsxSelfClosingElement(child)) return false;
    return false;
  });
}

function lineOf(source, node) {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function auditFile(file) {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const findings = [];

  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText();
      const attrs = node.attributes.properties.filter(ts.isJsxAttribute);
      const line = lineOf(source, node);

      if (INTERACTIVE.has(tag)) {
        // An element explicitly hidden from the accessibility tree (a
        // gesture-only wrapper) is not exposed, so it needs no role or name.
        const hidden = attrValue(attrs, 'accessible') === false;
        const labelled = hasAttr(attrs, HAS_LABEL) || hasTextChild(node.parent);
        const roled = hasAttr(attrs, HAS_ROLE);
        if (!hidden && !labelled) {
          findings.push({ line, tag, rule: 'interactive-needs-label', message: `<${tag}> has no accessibilityLabel and no text child` });
        }
        if (!hidden && !roled) {
          findings.push({ line, tag, rule: 'interactive-needs-role', message: `<${tag}> has no accessibilityRole` });
        }
      }

      if (MEDIA.has(tag)) {
        const labelled = hasAttr(attrs, HAS_LABEL);
        const decorative = hasAttr(attrs, DECORATIVE);
        if (!labelled && !decorative) {
          findings.push({ line, tag, rule: 'media-needs-label-or-decorative', message: `<${tag}> has no accessibilityLabel and is not marked decorative` });
        }
      }

      if (INPUTS.has(tag)) {
        const labelled = hasAttr(attrs, HAS_LABEL);
        if (!labelled) {
          findings.push({ line, tag, rule: 'input-needs-label', message: `<${tag}> has no accessibilityLabel` });
        }
      }

      if (TOGGLES.has(tag)) {
        const labelled = hasAttr(attrs, HAS_LABEL);
        if (!labelled) {
          findings.push({ line, tag, rule: 'toggle-needs-label', message: `<${tag}> has no accessibilityLabel` });
        }
      }

      if (tag === 'Modal') {
        // A modal must trap the screen reader inside itself; otherwise
        // VoiceOver can wander into the screen behind it.
        const traps = subtreeHasAttr(node.parent, 'accessibilityViewIsModal');
        if (!traps) {
          findings.push({ line, tag, rule: 'modal-needs-view-is-modal', message: '<Modal> content is not marked accessibilityViewIsModal' });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return findings;
}

export function auditProject(root = ROOT, dirs = SCAN_DIRS) {
  const files = dirs.flatMap((dir) => walk(join(root, dir)));
  const results = [];
  for (const file of files) {
    const findings = auditFile(file);
    if (findings.length > 0) {
      results.push({ file: relative(root, file), findings });
    }
  }
  return { filesScanned: files.length, results };
}

const isMain = (() => {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
  } catch {
    return false;
  }
})();

if (isMain) {
  const { filesScanned, results } = auditProject();
  const json = process.argv.includes('--json');
  const strict = process.argv.includes('--strict');

  if (json) {
    console.log(JSON.stringify({ filesScanned, results }, null, 2));
  } else {
    const total = results.reduce((sum, r) => sum + r.findings.length, 0);
    console.log(`Scanned ${filesScanned} files — ${total} finding(s) in ${results.length} file(s).\n`);
    for (const { file, findings } of results) {
      console.log(file);
      for (const f of findings) {
        console.log(`  ${f.line}:${f.tag}  [${f.rule}] ${f.message}`);
      }
      console.log('');
    }
  }

  if (strict && results.length > 0) process.exit(1);
}
