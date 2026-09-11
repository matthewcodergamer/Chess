import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const mainPath = path.join(root, 'src', 'main.tsx');
const stylesDir = path.join(root, 'src', 'styles');
const indexPath = path.join(stylesDir, 'index.css');

const requiredModules = [
  'tokens.css',
  'typography.css',
  'buttons.css',
  'navigation.css',
  'home.css',
  'board.css',
  'game.css',
  'tournaments.css',
  'dialogs.css',
  'forms.css',
  'payments.css',
  'profile.css',
  'animations.css',
  'responsive.css',
];

const errors = [];
const main = fs.readFileSync(mainPath, 'utf8');
if (!main.includes("import './styles/index.css';")) {
  errors.push('src/main.tsx must import ./styles/index.css as the only first-party CSS entrypoint.');
}
if (/import\s+['"]\.\/(?:v\d|styles\.css|experience\.css|product-system\.css)/.test(main)) {
  errors.push('src/main.tsx contains a legacy/versioned stylesheet import.');
}

const index = fs.readFileSync(indexPath, 'utf8');
for (const file of requiredModules) {
  if (!index.includes(`@import './${file}';`)) errors.push(`styles/index.css is missing ${file}.`);
}

const styleFiles = fs.readdirSync(stylesDir).filter(file => file.endsWith('.css'));
for (const file of styleFiles) {
  if (file === 'responsive.css') continue;
  const css = fs.readFileSync(path.join(stylesDir, file), 'utf8');
  if (/@media\b/.test(css)) errors.push(`${file} contains @media; viewport rules belong in responsive.css.`);
}

const legacyFiles = fs.readdirSync(path.join(root, 'src')).filter(file => /^v\d+\.\d+\.css$/.test(file));
if (legacyFiles.length) errors.push(`Versioned CSS files must not return: ${legacyFiles.join(', ')}`);

if (errors.length) {
  console.error('\nQQURZ CSS architecture check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  console.error('');
  process.exit(1);
}

console.log(`QQURZ CSS architecture OK: ${requiredModules.length} modules, responsive rules centralized.`);
