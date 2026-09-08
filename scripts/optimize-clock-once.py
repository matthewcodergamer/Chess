from pathlib import Path


def replace_exact(path: str, old: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"Expected text not found in {path}: {old[:100]!r}")
    p.write_text(s.replace(old, new))


def replace_block(path: str, start: str, end: str, new: str) -> None:
    p = Path(path)
    s = p.read_text()
    i = s.find(start)
    if i < 0:
        raise SystemExit(f"Start marker not found in {path}: {start!r}")
    j = s.find(end, i)
    if j < 0:
        raise SystemExit(f"End marker not found in {path}: {end!r}")
    j += len(end)
    p.write_text(s[:i] + new + s[j:])


# Bigger finger targets and a snappier physical rocker.
replace_exact('src/premium/ChessClock3D.ts', 'new THREE.BoxGeometry(1.95, 0.48, 1.45)', 'new THREE.BoxGeometry(2.18, 0.62, 1.66)')
replace_exact('src/premium/ChessClock3D.ts', 'hit.position.set(x, 1.48, -0.10);', 'hit.position.set(x, 1.49, -0.10);')
replace_exact('src/premium/ChessClock3D.ts', 'const duration = 150;', 'const duration = 82;')
replace_exact('src/premium/ChessClock3D.ts', 'const overshoot = Math.sin(Math.PI * t) * target * 0.22;', 'const overshoot = Math.sin(Math.PI * t) * target * 0.10;')

# Compact 2D side-clock camera.
replace_exact(
    'src/ui/ChessClockViewport.tsx',
    "const camera = new THREE.PerspectiveCamera(27, 1, 0.1, 50);\n    camera.position.set(0, 6.0, 4.65);\n    camera.lookAt(0, 0.55, 0.05);",
    "const camera = new THREE.PerspectiveCamera(25, 1, 0.1, 50);\n    camera.position.set(0, 6.65, 5.25);\n    camera.lookAt(0, 0.50, 0.02);",
)
replace_exact(
    'src/ui/ChessClockViewport.tsx',
    'model.group.scale.setScalar(1.04);\n    model.group.position.y = 0.08;',
    'model.group.scale.setScalar(0.92);\n    model.group.position.y = 0.02;',
)

viewport_pointer = """    const raycaster = new THREE.Raycaster();
    const pickSide = (event: PointerEvent): ClockSide | null => {
      const rect = renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1),
      );
      raycaster.setFromCamera(ndc, camera);
      return (raycaster.intersectObjects(model.hitMeshes, false)[0]?.object.userData.clockSide as ClockSide | undefined) ?? null;
    };
    const pointerDown = (event: PointerEvent) => {
      if (disabledRef.current) return;
      const side = pickSide(event);
      if (!side || side !== pendingRef.current) return;
      event.preventDefault();
      animateChessClockRocker(model, side, render);
      slapRef.current?.();
    };
    renderer.domElement.addEventListener('pointerdown', pointerDown, { passive: false });"""
replace_block(
    'src/ui/ChessClockViewport.tsx',
    '    const raycaster = new THREE.Raycaster();',
    "    renderer.domElement.addEventListener('pointercancel', pointerUp);",
    viewport_pointer,
)
replace_exact(
    'src/ui/ChessClockViewport.tsx',
    "      renderer.domElement.removeEventListener('pointerdown', pointerDown);\n      renderer.domElement.removeEventListener('pointermove', pointerMove);\n      renderer.domElement.removeEventListener('pointerup', pointerUp);\n      renderer.domElement.removeEventListener('pointercancel', pointerUp);",
    "      renderer.domElement.removeEventListener('pointerdown', pointerDown);",
)
replace_exact(
    'src/ui/ChessClockViewport.tsx',
    """  return (
    <div className={`qqurz-clock-viewport ${disabled ? 'disabled' : ''} ${className}`.trim()}>
      <div ref={mount} className="qqurz-clock-canvas" aria-label="Interactive top-down QQURZ chess clock" />
      <div className="qqurz-clock-caption">
        <span>TOURNAMENT CLOCK</span>
        <small>{pendingSlap && !disabled ? `Tap the ${pendingSlap} side of the white rocker` : 'Live LCD · physical rocker'}</small>
      </div>
    </div>
  );""",
    """  return (
    <div className={`qqurz-clock-viewport ${disabled ? 'disabled' : ''} ${pendingSlap && !disabled ? 'ready-to-slap' : ''} ${className}`.trim()}>
      <div ref={mount} className="qqurz-clock-canvas" aria-label="Interactive top-down QQURZ chess clock" />
      <div className="qqurz-clock-status" aria-hidden="true">
        {pendingSlap && !disabled ? `SLAP ${pendingSlap.toUpperCase()}` : 'LIVE CLOCK'}
      </div>
    </div>
  );""",
)

# Remove the secondary slap button; the rendered physical clock itself is the control.
replace_exact(
    'src/LocalGame.tsx',
    """          {phase === 'playing' && pendingSlap && pendingSlap !== aiColor && (
            <button className={`clock-slap-button clock-accessibility-slap ${pendingSlap}`} onClick={slapClock} aria-label={`Press ${pendingSlap} clock`}>
              <span>MOVE MADE</span><strong>SLAP {pendingSlap.toUpperCase()} CLOCK</strong><small>Tap the 3D rocker at left, or use this backup control.</small>
            </button>
          )}
""",
    '',
)

# Premium 3D scene: farther-back view, smaller side clock, immediate touch-down slap.
replace_exact(
    'src/premium/PremiumBoard3D.tsx',
    '    handle.camera.position.set(0.2, 15.8, 15.2);\n    handle.controls.target.set(-0.45, 0.45, 0.1);',
    '    handle.camera.position.set(0.0, 16.7, 16.8);\n    handle.controls.target.set(-0.55, 0.32, 0.08);',
)
replace_exact(
    'src/premium/PremiumBoard3D.tsx',
    '    const camera = new THREE.PerspectiveCamera(29, 1, 0.1, 100);\n    camera.position.set(0.2, 15.8, 15.2);\n    camera.lookAt(-0.45, 0.45, 0.1);',
    '    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);\n    camera.position.set(0.0, 16.7, 16.8);\n    camera.lookAt(-0.55, 0.32, 0.08);',
)
replace_exact('src/premium/PremiumBoard3D.tsx', '    controls.minDistance = 16;\n    controls.maxDistance = 24;', '    controls.minDistance = 17;\n    controls.maxDistance = 26;')
replace_exact('src/premium/PremiumBoard3D.tsx', '    controls.target.set(-0.45, 0.45, 0.1);', '    controls.target.set(-0.55, 0.32, 0.08);')
replace_exact(
    'src/premium/PremiumBoard3D.tsx',
    '    clock.group.scale.setScalar(0.78);\n    clock.group.position.set(-5.72, -0.39, 0.95);\n    clock.group.rotation.y = 0.03;',
    '    clock.group.scale.setScalar(0.64);\n    clock.group.position.set(-5.32, -0.39, 0.82);\n    clock.group.rotation.y = 0.02;',
)
replace_exact(
    'src/premium/PremiumBoard3D.tsx',
    """    const pointerDown = (event: PointerEvent) => {
      sx = event.clientX;
      sy = event.clientY;
      moved = false;
      downClock = pickClock(event);
      downSquare = downClock ? null : pickSquare(event);
    };""",
    """    const pointerDown = (event: PointerEvent) => {
      sx = event.clientX;
      sy = event.clientY;
      moved = false;
      downClock = pickClock(event);
      if (downClock) {
        event.preventDefault();
        event.stopPropagation();
        downSquare = null;
        clockSlapRef.current(downClock);
        return;
      }
      downSquare = pickSquare(event);
    };""",
)
replace_exact(
    'src/premium/PremiumBoard3D.tsx',
    """    const pointerUp = (event: PointerEvent) => {
      if (moved) return;
      const clockSide = pickClock(event);
      if (downClock && clockSide && downClock === clockSide) {
        clockSlapRef.current(clockSide);
        return;
      }
      const up = pickSquare(event);
      if (downSquare && up && downSquare === up) selectRef.current(up);
    };""",
    """    const pointerUp = (event: PointerEvent) => {
      if (downClock) { downClock = null; return; }
      if (moved) return;
      const up = pickSquare(event);
      if (downSquare && up && downSquare === up) selectRef.current(up);
    };""",
)
replace_exact('src/premium/PremiumBoard3D.tsx', "    renderer.domElement.addEventListener('pointerdown', pointerDown);", "    renderer.domElement.addEventListener('pointerdown', pointerDown, { capture: true, passive: false });")
replace_exact('src/premium/PremiumBoard3D.tsx', "      renderer.domElement.removeEventListener('pointerdown', pointerDown);", "      renderer.domElement.removeEventListener('pointerdown', pointerDown, true);")
replace_exact('src/premium/PremiumBoard3D.tsx', '<h1>Real board. Real clock. Tap the rocker.</h1>', '<h1>Move. Slap. Next turn.</h1>')
replace_exact('src/premium/PremiumBoard3D.tsx', '<p>The reference-matched QQURZ tournament clock now sits beside the board, shows the live game timers, and its white rocker is the actual clock control.</p>', '<p>The tournament clock sits tight beside the board. Touch your half of the white rocker and the turn passes immediately—no extra clock button.</p>')
replace_exact('src/premium/PremiumBoard3D.tsx', '<span className="three-inline-note">Tap rocker to pass the turn · drag to rotate · pinch/scroll to zoom</span>', '<span className="three-inline-note">Touch rocker = instant clock press · drag board to rotate · pinch/scroll to zoom</span>')
replace_exact('src/premium/PremiumBoard3D.tsx', '<div className="three-board-help">Move piece → tap matching side of white rocker</div>', '<div className="three-board-help">Move → slap your side of the rocker</div>')
replace_exact(
    'src/premium/PremiumBoard3D.tsx',
    """          {phase === 'playing' && pendingSlap && pendingSlap !== aiColor && (
            <button className={`clock-slap-inline three-slap ${pendingSlap}`} onClick={() => slapClock()}>
              SLAP {pendingSlap.toUpperCase()} CLOCK
            </button>
          )}
""",
    '',
)

# Compact clock styling so board + clock read as one tight play surface.
p = Path('src/v1.9.css')
s = p.read_text()
s = s.replace('  margin-top: 16px;', '  margin-top: 10px;', 1)
s = s.replace('  border-radius: 18px;', '  border-radius: 15px;', 1)
s = s.replace('  aspect-ratio: 1.5 / 1;\n  min-height: 148px;', '  aspect-ratio: 1.92 / 1;\n  min-height: 108px;')
s = s.replace(
    ".qqurz-clock-caption {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  gap: 10px;\n  padding: 8px 10px 10px;\n  color: rgba(255,255,255,.68);\n  border-top: 1px solid rgba(255,255,255,.07);\n  background: rgba(7,8,9,.72);\n}\n.qqurz-clock-caption span {\n  color: rgba(255,255,255,.9);\n  font-size: 8px;\n  font-weight: 900;\n  letter-spacing: .12em;\n}\n.qqurz-clock-caption small {\n  text-align: right;\n  font-size: 8px;\n  line-height: 1.3;\n}\n",
    ".qqurz-clock-status {\n  position: absolute;\n  left: 8px;\n  bottom: 8px;\n  z-index: 3;\n  padding: 5px 7px;\n  border-radius: 999px;\n  border: 1px solid rgba(255,255,255,.12);\n  background: rgba(7,8,9,.58);\n  color: rgba(255,255,255,.78);\n  backdrop-filter: blur(8px);\n  -webkit-backdrop-filter: blur(8px);\n  font-size: 7px;\n  font-weight: 900;\n  letter-spacing: .1em;\n  pointer-events: none;\n}\n.qqurz-clock-viewport.ready-to-slap {\n  border-color: rgba(93,218,168,.58);\n  box-shadow: inset 0 0 0 1px rgba(93,218,168,.14), 0 8px 20px rgba(0,0,0,.12);\n}\n",
)
s = s.replace(
    '.local-clock-model { margin-bottom: 12px; }\n.local-clocks.compact-readout { margin-top: 8px; }\n.local-with-physical-clock .local-fast-side { width: 286px; }',
    '.local-clock-model { margin-bottom: 8px; }\n.local-clocks.compact-readout { margin-top: 6px; }\n.local-with-physical-clock.local-fast-shell { grid-template-columns: 220px minmax(0,820px); gap: 14px; }\n.local-with-physical-clock .local-fast-side { width: auto; padding: 14px; }',
)
s = s.replace('  .qqurz-clock-canvas { min-height: 132px; }', '  .qqurz-clock-canvas { min-height: 104px; }')
s = s.replace(
    '  .local-clock-model {\n    width: min(100%, 390px);\n    margin-left: auto;\n    margin-right: auto;\n  }\n  .qqurz-clock-canvas {\n    aspect-ratio: 1.8 / 1;\n    min-height: 150px;\n  }\n  .clock-accessibility-slap {\n    bottom: 8px;\n    min-height: 64px;\n  }',
    '  .local-clock-model {\n    width: min(48vw, 210px);\n    margin: 0;\n    align-self: start;\n  }\n  .qqurz-clock-canvas {\n    aspect-ratio: 1.92 / 1;\n    min-height: 98px;\n  }\n  .local-with-physical-clock .local-fast-side {\n    grid-template-columns: minmax(0, 1fr) auto;\n    align-items: start;\n  }\n  .local-with-physical-clock .local-fast-side > div:first-child { min-width: 0; }',
)
p.write_text(s)

replace_exact('package.json', '"version": "1.9.0"', '"version": "1.9.1"')

# Self-cleanup so these migration files do not remain in the product repository.
for disposable in ['scripts/optimize-clock-once.py', '.github/workflows/optimize-clock-once.yml']:
    Path(disposable).unlink(missing_ok=True)
