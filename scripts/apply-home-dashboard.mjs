import fs from 'node:fs';

const appPath = 'src/AppV14.tsx';
let app = fs.readFileSync(appPath, 'utf8');
app = app.replace("import HomeBoardPreview from './ui/HomeBoardPreview';", "import HomeDashboard from './ui/HomeDashboard';");
const startMarker = "      {screen === 'home' && (";
const endMarker = "      {screen === 'local' &&";
const start = app.indexOf(startMarker);
const end = app.indexOf(endMarker, start);
if (start < 0 || end < 0) throw new Error('Could not find home route boundaries in AppV14.tsx');
const replacement = `      {screen === 'home' && (\n        <HomeDashboard\n          onlineLabel={onlineLabel}\n          onProfile={() => openScreen('account')}\n          onTournament={() => openScreen('tournaments')}\n          onFriend={openFriends}\n          onSameDevice={() => openLocal('human')}\n          onMatchmaking={openMatchmaking}\n          onPremium3D={() => openScreen('3d')}\n          onAI={() => openLocal('ai')}\n        />\n      )}\n\n`;
app = app.slice(0, start) + replacement + app.slice(end);
fs.writeFileSync(appPath, app);

const responsivePath = 'src/styles/responsive.css';
let responsive = fs.readFileSync(responsivePath, 'utf8');
const marker = '/* Home dashboard responsive layout */';
if (!responsive.includes(marker)) {
  responsive += `\n\n${marker}\n@media (max-width:900px){\n  .home-dashboard{grid-template-columns:1fr;max-width:760px}\n  .home-player-status,.home-activity-grid,.home-premium-row,.home-ai-row,.qqurz-home-footer-v24{grid-column:1}\n  .home-board-area{width:100%;max-width:680px;justify-self:center}\n}\n\n@media (max-width:720px){\n  .qqurz-home-v24.home-dashboard{width:100%;max-width:none;padding:var(--q-space-16) var(--q-space-12) calc(var(--q-space-32) + env(safe-area-inset-bottom));gap:var(--q-space-16)}\n  .home-player-status{min-height:0;padding:var(--q-space-8);gap:var(--q-space-8)}\n  .home-player-identity,.home-online-status{padding-inline:var(--q-space-8)}\n  .home-player-avatar{width:var(--q-control-sm);height:var(--q-control-sm)}\n  .home-play-panel{padding:var(--q-space-16);gap:var(--q-space-16);border-radius:var(--q-radius-md)}\n  .home-play-heading h1{font-size:var(--q-type-title)}\n  .home-time-control{padding-top:var(--q-space-12)}\n  .home-secondary-play{grid-template-columns:1fr;gap:var(--q-space-8)}\n  .home-board-area{padding:var(--q-space-8);border-radius:var(--q-radius-md);box-shadow:none}\n  .home-section-heading{padding:var(--q-space-4) var(--q-space-4) var(--q-space-8)}\n  .home-live-board-shell{padding:var(--q-space-8);border-radius:var(--q-radius-sm);box-shadow:none}\n  .home-activity-grid{grid-template-columns:1fr;gap:var(--q-space-8)}\n  .home-activity-card{grid-template-columns:auto minmax(0,1fr);padding:var(--q-space-12)}\n  .home-activity-card>.qqurz-button{grid-column:1/-1;width:100%}\n  .home-premium-row,.home-ai-row{grid-template-columns:auto minmax(0,1fr);gap:var(--q-space-12);padding:var(--q-space-12)}\n  .home-premium-row>.qqurz-button,.home-ai-row>.qqurz-button{grid-column:1/-1;width:100%}\n  .qqurz-home-footer-v24{padding-top:var(--q-space-8)}\n}\n\n@media (max-width:480px){\n  .home-player-status{display:grid;grid-template-columns:minmax(0,1fr) auto}\n  .home-online-status{width:var(--q-control-sm);padding:0;justify-content:center}\n  .home-online-status>span:last-child{display:none}\n  .home-play-heading{align-items:flex-start}\n  .home-time-control>div:first-child{align-items:flex-start;flex-direction:column;gap:var(--q-space-4)}\n  .home-time-segments{gap:var(--q-space-4)}\n  .home-section-heading{align-items:flex-start}\n  .home-section-heading>div{min-width:0}\n  .home-section-heading>.qqurz-button{flex:0 0 auto}\n  .qqurz-home-footer-v24{display:grid;gap:var(--q-space-4)}\n}\n`;
  fs.writeFileSync(responsivePath, responsive);
}

console.log('QQURZ homepage dashboard wired.');
