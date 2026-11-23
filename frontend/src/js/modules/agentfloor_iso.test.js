'use strict';

const assert = require('assert');
const {
  FACE,
  rotateCell,
  project,
  sortQueue,
  shade,
  drawVoxelCube,
  drawVoxelAgent,
  buildStaticBuffer,
  renderFrame,
  drawIsoBox,
  drawLeftPatch,
  drawRightPatch,
  drawTopPatch,
  drawMinecraftWaterCooler,
  drawMinecraftToilet,
  drawMinecraftWorkstation,
  drawMinecraftOfficeChair,
  drawMinecraftPlant,
  drawMinecraftSink,
  drawMinecraftConferenceTable,
  drawMinecraftCoffeeMachine
} = require('./agentfloor_iso.js');

console.log('🧪 Running AgentFloor 2.5D Isometric Voxel Engine Unit Tests...\n');

let testsPassed = 0;

function runTest(name, fn) {
  try {
    fn();
    testsPassed++;
    console.log(`  ✅ Test ${testsPassed}: ${name}`);
  } catch (err) {
    console.error(`  ❌ Test FAILED: ${name}`);
    console.error(err);
    process.exit(1);
  }
}

// -----------------------------------------------------------------------------
// Test 1: Rotation 0° identity and 360° symmetry
// -----------------------------------------------------------------------------
runTest('Rotation 0° identity and 360° full symmetry (rot = 0, 4, -4, 8)', () => {
  const w = 20, h = 14;
  const cells = [{ x: 0, y: 0 }, { x: 5, y: 7 }, { x: 19, y: 13 }];
  for (const c of cells) {
    assert.deepStrictEqual(rotateCell(c.x, c.y, 0, w, h), { x: c.x, y: c.y });
    assert.deepStrictEqual(rotateCell(c.x, c.y, 4, w, h), { x: c.x, y: c.y });
    assert.deepStrictEqual(rotateCell(c.x, c.y, -4, w, h), { x: c.x, y: c.y });
    assert.deepStrictEqual(rotateCell(c.x, c.y, 8, w, h), { x: c.x, y: c.y });
  }
});

// -----------------------------------------------------------------------------
// Test 2: Rotation 90° clockwise with grid dimension swap
// -----------------------------------------------------------------------------
runTest('Rotation 90° clockwise dimension swap (x: h - 1 - y, y: x)', () => {
  const w = 20, h = 14;
  // Corner (0, 0) -> (h - 1 - 0, 0) = (13, 0)
  assert.deepStrictEqual(rotateCell(0, 0, 1, w, h), { x: 13, y: 0 });
  // Corner (19, 0) -> (13, 19)
  assert.deepStrictEqual(rotateCell(19, 0, 1, w, h), { x: 13, y: 19 });
  // Corner (19, 13) -> (0, 19)
  assert.deepStrictEqual(rotateCell(19, 13, 1, w, h), { x: 0, y: 19 });
  // Corner (0, 13) -> (0, 0)
  assert.deepStrictEqual(rotateCell(0, 13, 1, w, h), { x: 0, y: 0 });
  // Interior point (3, 4) -> (14 - 1 - 4, 3) = (9, 3)
  assert.deepStrictEqual(rotateCell(3, 4, 1, w, h), { x: 9, y: 3 });
});

// -----------------------------------------------------------------------------
// Test 3: Rotation 180° inversion
// -----------------------------------------------------------------------------
runTest('Rotation 180° inversion symmetry (x: w - 1 - x, y: h - 1 - y)', () => {
  const w = 20, h = 14;
  const p = { x: 3, y: 4 };
  const r2 = rotateCell(p.x, p.y, 2, w, h);
  assert.deepStrictEqual(r2, { x: 16, y: 9 });
  // Inverting twice restores original point
  const restored = rotateCell(r2.x, r2.y, 2, w, h);
  assert.deepStrictEqual(restored, p);
  // Center symmetry check
  assert.deepStrictEqual(rotateCell(0, 0, 2, w, h), { x: 19, y: 13 });
  assert.deepStrictEqual(rotateCell(19, 13, 2, w, h), { x: 0, y: 0 });
});

// -----------------------------------------------------------------------------
// Test 4: Rotation 270° clockwise (-90° counter-clockwise)
// -----------------------------------------------------------------------------
runTest('Rotation 270° clockwise / -90° CCW (x: y, y: w - 1 - x)', () => {
  const w = 20, h = 14;
  const p = { x: 3, y: 4 };
  const r3 = rotateCell(p.x, p.y, 3, w, h);
  assert.deepStrictEqual(r3, { x: 4, y: 16 });
  assert.deepStrictEqual(rotateCell(p.x, p.y, -1, w, h), { x: 4, y: 16 });
  // 4 successive 90-degree rotations loop back
  const step1 = rotateCell(p.x, p.y, 1, w, h); // in h x w
  const step2 = rotateCell(step1.x, step1.y, 1, h, w); // in w x h
  const step3 = rotateCell(step2.x, step2.y, 1, w, h); // in h x w
  const step4 = rotateCell(step3.x, step3.y, 1, h, w); // in w x h
  assert.deepStrictEqual(step4, p);
});

// -----------------------------------------------------------------------------
// Test 5: 2:1 Dimetric/Isometric screen projection offsets
// -----------------------------------------------------------------------------
runTest('2:1 Isometric projection screen coordinate axis offsets (tw=48, th=24)', () => {
  const cam = { rot: 0, ox: 520, oy: 140, tw: 48, th: 24, zh: 18 };
  const w = 16, h = 16;

  // Origin (0, 0, 0)
  const p0 = project(0, 0, 0, cam, w, h);
  assert.strictEqual(p0.sx, 520);
  assert.strictEqual(p0.sy, 140);

  // +x axis step: (1, 0, 0)
  const px = project(1, 0, 0, cam, w, h);
  const deltaX_sx = px.sx - p0.sx; // +24
  const deltaX_sy = px.sy - p0.sy; // +12
  assert.strictEqual(deltaX_sx, 24);
  assert.strictEqual(deltaX_sy, 12);
  assert.strictEqual(deltaX_sx / deltaX_sy, 2.0); // 2:1 dimetric ratio!

  // +y axis step: (0, 1, 0)
  const py = project(0, 1, 0, cam, w, h);
  const deltaY_sx = py.sx - p0.sx; // -24
  const deltaY_sy = py.sy - p0.sy; // +12
  assert.strictEqual(deltaY_sx, -24);
  assert.strictEqual(deltaY_sy, 12);
  assert.strictEqual(Math.abs(deltaY_sx) / deltaY_sy, 2.0); // 2:1 dimetric ratio!

  // Compound coordinate (4, 2, 0)
  const p42 = project(4, 2, 0, cam, w, h);
  assert.strictEqual(p42.sx, (4 - 2) * 24 + 520); // 568
  assert.strictEqual(p42.sy, (4 + 2) * 12 + 140); // 212
});

// -----------------------------------------------------------------------------
// Test 6: Vertical z-axis elevation projection
// -----------------------------------------------------------------------------
runTest('Vertical z-axis elevation projection (sy shifted by -z * zh)', () => {
  const cam = { rot: 0, ox: 520, oy: 140, tw: 48, th: 24, zh: 18 };
  const w = 16, h = 16;

  const ground = project(5, 5, 0, cam, w, h);
  const elevated = project(5, 5, 2, cam, w, h);

  assert.strictEqual(elevated.sx, ground.sx, 'Screen X must not change with vertical z elevation');
  assert.strictEqual(ground.sy - elevated.sy, 2 * cam.zh, 'Screen Y must move up by exactly z * zh');
  assert.strictEqual(elevated.sy, ground.sy - 36);
});

// -----------------------------------------------------------------------------
// Test 7: Depth-sorting behind and in front of desks (sortQueue)
// -----------------------------------------------------------------------------
runTest('Depth-sorting behind and in front of desks (sortQueue d = rx + ry)', () => {
  const scene = {
    w: 16,
    h: 16,
    camera: { rot: 0, ox: 520, oy: 140, tw: 48, th: 24, zh: 18 },
    blocks: [
      { id: 'desk', x: 5, y: 5, z: 0, color: '#6d4525' }
    ],
    entities: [
      { id: 'agent_behind', x: 4, y: 4, z: 1, name: 'Alice' },
      { id: 'agent_in_front', x: 6, y: 6, z: 1, name: 'Bob' }
    ]
  };

  const q = sortQueue(scene);
  assert.strictEqual(q.length, 3);
  assert.strictEqual(q[0].kind, 'entity');
  assert.strictEqual(q[0].item.id, 'agent_behind', 'Entity behind desk must render first');
  assert.strictEqual(q[1].kind, 'block');
  assert.strictEqual(q[1].item.id, 'desk', 'Desk block must render between behind and front agents');
  assert.strictEqual(q[2].kind, 'entity');
  assert.strictEqual(q[2].item.id, 'agent_in_front', 'Entity in front of desk must render last');
});

// -----------------------------------------------------------------------------
// Test 8: Depth-sorting 180° inversion
// -----------------------------------------------------------------------------
runTest('Depth-sorting 180° camera inversion (rot = 2 inverts render order)', () => {
  const sceneRot0 = {
    w: 12,
    h: 12,
    camera: { rot: 0, ox: 520, oy: 140, tw: 48, th: 24, zh: 18 },
    blocks: [
      { id: 'block_near', x: 2, y: 2, z: 0 },
      { id: 'block_far', x: 8, y: 8, z: 0 }
    ],
    entities: []
  };

  const q0 = sortQueue(sceneRot0);
  assert.strictEqual(q0[0].item.id, 'block_near');
  assert.strictEqual(q0[1].item.id, 'block_far');

  // Rotate 180 degrees (rot = 2)
  const sceneRot2 = {
    ...sceneRot0,
    camera: { ...sceneRot0.camera, rot: 2 }
  };
  const q2 = sortQueue(sceneRot2);
  // (2, 2) at rot=2 -> (12 - 1 - 2, 12 - 1 - 2) = (9, 9), d = 18
  // (8, 8) at rot=2 -> (12 - 1 - 8, 12 - 1 - 8) = (3, 3), d = 6
  assert.strictEqual(q2[0].item.id, 'block_far', 'Block previously far must now be near and render first');
  assert.strictEqual(q2[1].item.id, 'block_near', 'Block previously near must now be far and render last');
});

// -----------------------------------------------------------------------------
// Test 9: Minecraft Furniture Build Hacks Suite Rendering
// -----------------------------------------------------------------------------
runTest('Minecraft furniture suite renders correctly to canvas context without throwing', () => {
  const calls = { poly: 0, fill: 0 };
  const mockCtx = {
    beginPath: () => {},
    moveTo: () => calls.poly++,
    lineTo: () => calls.poly++,
    closePath: () => {},
    fill: () => calls.fill++,
    fillStyle: ''
  };

  // Render all 8 authentic Minecraft build hacks
  drawMinecraftWaterCooler(mockCtx, 100, 100);
  drawMinecraftToilet(mockCtx, 200, 100);
  drawMinecraftWorkstation(mockCtx, 300, 100, { woodColor: '#5c3d24', screenWorking: true });
  drawMinecraftOfficeChair(mockCtx, 400, 100, '#334155');
  drawMinecraftPlant(mockCtx, 500, 100);
  drawMinecraftSink(mockCtx, 600, 100);
  drawMinecraftConferenceTable(mockCtx, 700, 100);
  drawMinecraftCoffeeMachine(mockCtx, 800, 100);

  assert.ok(calls.fill > 50, 'All furniture items must emit multiple polygon fills');
  assert.ok(calls.poly > 150, 'Multiple geometric vertices must be constructed');
});

// -----------------------------------------------------------------------------
// Test 10: Authentic Steve & Alex 4-Directional Character Rendering
// -----------------------------------------------------------------------------
runTest('Steve & Alex 4-directional character rendering (sw, se, nw, ne)', () => {
  const cam = { rot: 0, ox: 520, oy: 140, tw: 48, th: 24, zh: 18 };
  const facings = ['sw', 'se', 'nw', 'ne'];
  let totalDraws = 0;

  const mockCtx = {
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => totalDraws++,
    fillStyle: ''
  };

  for (const facing of facings) {
    // Steve walking
    drawVoxelAgent(mockCtx, {
      x: 5, y: 5, z: 1,
      model: 'steve',
      facing,
      isWalking: true,
      walkPhase: Math.PI / 4,
      state: 'walking'
    }, cam, 16, 16);

    // Alex seated & working
    drawVoxelAgent(mockCtx, {
      x: 6, y: 6, z: 1,
      model: 'alex',
      facing,
      isWalking: false,
      state: 'working'
    }, cam, 16, 16);
  }

  assert.ok(totalDraws > 100, '4-directional Steve and Alex render operations must execute across all facings');
});

// -----------------------------------------------------------------------------
// Test 11: Static buffer depth-sorted composite with floor tiles, walls, and furniture
// -----------------------------------------------------------------------------
runTest('Static buffer depth-sorted composite with floor tiles, walls, and furniture', () => {
  const scene = {
    w: 16,
    h: 16,
    camera: { rot: 0, ox: 520, oy: 140, tw: 48, th: 24, zh: 18 },
    blocks: [
      { x: 0, y: 0, z: 0, color: '#111c30' },
      { x: 5, y: 5, z: 0, color: '#152138' },
      { x: 0, y: 0, z: 1, color: '#1e293b' }
    ],
    furniture: [
      { type: 'cooler', x: 14, y: 3, z: 1 },
      { type: 'toilet', x: 13, y: 14, z: 1 },
      { type: 'desk', x: 5, y: 7, z: 1 }
    ]
  };

  const buffer = buildStaticBuffer(scene, 1040, 540);
  assert.ok(buffer, 'buildStaticBuffer must return an offscreen canvas buffer');
  assert.strictEqual(buffer.width, 1040);
  assert.strictEqual(buffer.height, 540);
});

console.log(`\n🎉 All ${testsPassed} unit tests passed successfully!\n`);

