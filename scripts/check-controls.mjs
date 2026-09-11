import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const controlsPath = path.join(root, 'src', 'ui', 'controls.tsx');
const buttonsPath = path.join(root, 'src', 'styles', 'buttons.css');
const errors = [];

if (!fs.existsSync(controlsPath)) {
  errors.push('src/ui/controls.tsx is missing.');
} else {
  const controls = fs.readFileSync(controlsPath, 'utf8');
  for (const name of ['PrimaryButton', 'SecondaryButton', 'DestructiveButton', 'SegmentedControl', 'IconButton']) {
    if (!controls.includes(`export function ${name}`)) errors.push(`controls.tsx must export ${name}.`);
  }
  if (!controls.includes('loading') || !controls.includes('aria-busy')) errors.push('Shared buttons must preserve the loading state and expose aria-busy.');
}

const css = fs.readFileSync(buttonsPath, 'utf8');
for (const selector of ['.qqurz-button--primary', '.qqurz-button--secondary', '.qqurz-button--destructive', '.qqurz-segmented', '.qqurz-icon-button', '.qqurz-button-spinner']) {
  if (!css.includes(selector)) errors.push(`buttons.css is missing ${selector}.`);
}
if (!css.includes('var(--q-motion-press)')) errors.push('Button press motion must use --q-motion-press.');
if (!css.includes('var(--q-control-sm)') || !css.includes('var(--q-control-md)') || !css.includes('var(--q-control-lg)')) errors.push('Buttons must use the 48/56/64 control tokens.');

if (errors.length) {
  console.error('\nQQURZ button-system check failed:\n');
  for (const error of errors) console.error(` - ${error}`);
  console.error('');
  process.exit(1);
}

console.log('QQURZ button system OK: five shared controls, token sizing, loading and press states present.');
