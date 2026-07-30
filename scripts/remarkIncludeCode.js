// Remark plugin: replace the body of a fenced code block carrying a
// `file=<path>` meta attribute with the referenced file's contents, resolved
// relative to the MDX file. Keeps documentation code in sync with runnable
// snippet files (e.g. snippets/*.py) — the snippet on the page can never
// drift from the file that CI executes. Throws on a missing file so a bad
// path fails the build instead of shipping an empty code block.
//
// Included files must live inside the repository's snippets/ directory. The
// plugin reads files from disk at build time, so an unconstrained `file=`
// path in an MDX fence would let a page embed arbitrary files from the build
// host (e.g. `file=../../next.config.js` or paths escaping the repo). Any
// resolved path outside snippets/ fails the build.
const fs = require('fs');
const path = require('path');

// This script lives in <repo root>/scripts/, so the repo root is one level up.
// realpathSync normalizes symlinks (e.g. macOS /tmp -> /private/tmp) so the
// containment check below compares canonical paths.
const SNIPPETS_ROOT = fs.realpathSync(path.resolve(__dirname, '..', 'snippets'));

module.exports = function remarkIncludeCode() {
  return (tree, vfile) => {
    const visit = node => {
      if (node.type === 'code' && node.meta) {
        const match = node.meta.match(/(?:^|\s)file=(\S+)/);
        if (match) {
          const baseDir = vfile.path ? path.dirname(vfile.path) : process.cwd();
          const snippetPath = path.resolve(baseDir, match[1]);
          if (!fs.existsSync(snippetPath)) {
            throw new Error(
              `remarkIncludeCode: ${vfile.path} references missing file ${snippetPath}`
            );
          }
          const realSnippetPath = fs.realpathSync(snippetPath);
          if (!realSnippetPath.startsWith(SNIPPETS_ROOT + path.sep)) {
            throw new Error(
              `remarkIncludeCode: ${vfile.path} references ${match[1]} ` +
                `(resolved to ${realSnippetPath}), which is outside the snippets/ ` +
                `directory. file= includes must point at files under ${SNIPPETS_ROOT}.`
            );
          }
          node.value = fs.readFileSync(realSnippetPath, 'utf8').trimEnd();
        }
      }
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    visit(tree);
  };
};
