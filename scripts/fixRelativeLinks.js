const fs = require('fs');
const path = require('path');
const util = require('util');

const readdir = util.promisify(fs.readdir);
const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);
const stat = util.promisify(fs.stat);

const directoryPath = '/Users/kenny/Documents/projects/upshot/docs/pages';

async function getAllFiles(dirPath, arrayOfFiles) {
  const files = await readdir(dirPath);

  arrayOfFiles = arrayOfFiles || [];

  await Promise.all(files.map(async file => {
    if (fs.statSync(path.join(dirPath, file)).isDirectory()) {
      arrayOfFiles = await getAllFiles(path.join(dirPath, file), arrayOfFiles);
    } else if (file.endsWith('.mdx')) {
      // Skip non-markdown files
      arrayOfFiles.push(path.join(dirPath, file));
    }
  }));

  return arrayOfFiles.filter(f => f);
}

async function findAndUpdateLinks(files) {
  let fileMap = {};

  files.forEach(file => {
    const baseName = path.basename(file);
    if (!fileMap[baseName]) {
      fileMap[baseName] = [];
    }
    fileMap[baseName].push(file);
  });

  for (const [filename, paths] of Object.entries(fileMap)) {
    if (paths.length > 1 && !filename.startsWith('index')) {
      // There are duplicate index.mdx files, which shouldn't be too link-worthy anyway
      console.log(`Duplicate filename detected: ${filename}. Files: ${paths.join(', ')}. Please rename to make them unique.`);
    }
  }

  await Promise.all(files.map(async file => {
    const content = await readFile(file, 'utf8');
    const dir = path.dirname(file);
    let modified = content;

    const linkRegex = /\]\((?!http)(.+?)\)/g;
    let match;

    while ((match = linkRegex.exec(content)) !== null) {
      // Skip images
      if (match[1].endsWith('.png') || match[1].endsWith('.jpg') || match[1].endsWith('.jpeg') || match[1].endsWith('.gif')) {
        continue;
      }
      const [fullMatch, linkPath] = match;
      let [resolvedPath, fragment] = linkPath.split('#');
      const targetFile = path.resolve(dir, resolvedPath);

      // console.log('dir', dir)
      // console.log('file', file)
      // console.log('targetFile', targetFile)

      if (!fs.existsSync(targetFile + '.mdx')) {
        console.log(`Broken link found in ${file}: ${linkPath} does not exist.`);
      } else {
        const correctPath = path.relative(dir, fileMap[path.basename(targetFile)][0]) + (fragment ? `#${fragment}` : '');
        modified = modified.replace(fullMatch, `](${correctPath})`);
      }
    }

    if (modified !== content) {
      await writeFile(file, modified, 'utf8');
      console.log(`Updated links in ${file}`);
    }
  }));
}

(async () => {
  try {
    const files = await getAllFiles(directoryPath);
    await findAndUpdateLinks(files);
  } catch (error) {
    console.error('An error occurred:', error);
  }
})();
