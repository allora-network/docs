// Remark plugin: replace the body of a fenced code block carrying a
// `file=<path>` meta attribute with the referenced file's contents, resolved
// relative to the MDX file. Keeps documentation code in sync with runnable
// snippet files (e.g. snippets/*.py) — the snippet on the page can never
// drift from the file that CI executes. Throws on a missing file so a bad
// path fails the build instead of shipping an empty code block.
const fs = require('fs');
const path = require('path');

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
          node.value = fs.readFileSync(snippetPath, 'utf8').trimEnd();
        }
      }
      if (node.children) {
        node.children.forEach(visit);
      }
    };
    visit(tree);
  };
};
