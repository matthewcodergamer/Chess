import fs from 'node:fs';

const path = 'src/styles/board.css';
let css = fs.readFileSync(path, 'utf8');

css = css.replace(
  '.cg-wrap piece.black:not(.fading):not(.ghost){opacity:1!important;filter:brightness(1.10) contrast(1.18);-webkit-filter:brightness(1.10) contrast(1.18)}.cg-wrap piece.white:not(.fading):not(.ghost){opacity:1!important;filter:none}',
  '.qqurz-chessboard piece:not(.fading):not(.ghost){opacity:1!important;filter:none!important;-webkit-filter:none!important}',
);

const marker = '/* Shared cburnett SVG asset system */';
if (!css.includes(marker)) {
  css += `

${marker}
.qqurz-piece-asset{display:inline-grid;place-items:center;width:28px;height:28px;line-height:0;overflow:visible;flex:0 0 auto}
.qqurz-piece-asset.qqurz-piece-sm{width:clamp(18px,5vw,26px);height:clamp(18px,5vw,26px)}
.qqurz-piece-asset.qqurz-piece-md{width:32px;height:32px}
.qqurz-piece-asset.qqurz-piece-lg{width:48px;height:48px}
.qqurz-piece-asset piece{position:relative!important;inset:auto!important;display:block!important;width:100%!important;height:100%!important;transform:none!important;background-position:50% 50%!important;background-repeat:no-repeat!important;background-size:100% 100%!important;opacity:1!important;filter:none!important;-webkit-filter:none!important;pointer-events:none}
.captured-piece-set{display:flex;align-items:center;min-width:0;max-width:100%;overflow:hidden;white-space:nowrap;flex:0 1 auto}
.captured-piece-set .captured-piece-asset{margin-right:-.34em}.captured-piece-set .captured-piece-asset:last-child{margin-right:0}
.captured-strip.compact .qqurz-piece-asset.qqurz-piece-sm{width:20px;height:20px}
.promotion-grid button,.online-promotion button{display:flex;align-items:center;justify-content:center;gap:var(--q-space-8)}
.promotion-grid button .qqurz-piece-asset,.online-promotion button .qqurz-piece-asset{flex:0 0 auto}
`;
}

fs.writeFileSync(path, css);
console.log('cburnett SVG fidelity styles applied.');
