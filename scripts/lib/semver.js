'use strict';

// The one semantic-version definition these scripts share.
//
//   scripts/checkVersionStrings.js  validates every value in versions.json
//   scripts/bumpVersions.js         decides what upstream published, and what
//                                   is newer than what
//
// They used to hold separate, differently-lenient ideas of what a version is:
// the checker enforced the full SemVer 2.0.0 grammar, while the bump job would
// accept `v1.2` or `v1.2.3.4` from a release feed and write it to the very file
// the checker guards — a green nightly PR that fails the build it opens. One
// definition, so that cannot happen again.
//
// Plain Node, no dependencies — the same constraint the rest of scripts/
// follows, which is why this is a local module rather than a package.

// SemVer 2.0.0, anchored, with the leading "v" this repo's chain keys carry
// made optional. Captures: major, minor, patch, prerelease, build.
const SEMVER =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

/** The parts of a version, or null if the string is not one. */
function parse(value) {
  if (typeof value !== 'string') return null;
  const match = SEMVER.exec(value);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    // Dot-separated identifiers, empty for a release.
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
    build: match[5] === undefined ? '' : match[5],
  };
}

function isValid(value) {
  return parse(value) !== null;
}

/**
 * True for a version carrying a prerelease identifier.
 *
 * Deliberately not "contains a hyphen": build metadata may contain hyphens too,
 * so `v1.2.3+build-5` is a *release* whose metadata happens to look like a
 * prerelease. Reading the parsed prerelease field is the only way to tell.
 */
function isPrerelease(value) {
  const parsed = parse(value);
  return parsed !== null && parsed.prerelease.length > 0;
}

const isNumeric = identifier => /^\d+$/.test(identifier);

/** SemVer 2.0.0 §11 precedence for the prerelease part. */
function comparePrerelease(left, right) {
  // "a pre-release version has lower precedence than a normal version" — this
  // is the rule that kept `1.2.3-rc.1` looking equal to `1.2.3`, so the bump
  // job never advanced off a release candidate once the final shipped.
  if (left.length === 0 && right.length === 0) return 0;
  if (left.length === 0) return 1;
  if (right.length === 0) return -1;

  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    // "a larger set of pre-release fields has a higher precedence".
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    if (left[i] === right[i]) continue;

    const leftNumeric = isNumeric(left[i]);
    const rightNumeric = isNumeric(right[i]);
    // "identifiers consisting of only digits are compared numerically";
    // "numeric identifiers always have lower precedence than alphanumeric".
    if (leftNumeric && rightNumeric) return Number(left[i]) < Number(right[i]) ? -1 : 1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[i] < right[i] ? -1 : 1;
  }

  return 0;
}

/**
 * -1 / 0 / 1 as `a` is older than, equal to, or newer than `b`; null if either
 * is not a version. Build metadata is ignored, per SemVer 2.0.0 §10.
 */
function compare(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) return null;

  for (const part of ['major', 'minor', 'patch']) {
    if (left[part] !== right[part]) return left[part] < right[part] ? -1 : 1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
}

// parse() and SEMVER stay module-private: nothing outside needs the parts, and
// an export nobody calls is a contract to keep in step for no benefit.
module.exports = { isValid, isPrerelease, compare };
