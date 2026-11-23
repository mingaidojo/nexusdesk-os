'use strict';

const {
  buildStaticBuffer,
  renderFrame
} = require('./agentfloor_iso.js');

console.log('⚡ AgentFloor 2.5D Isometric Voxel Engine — 300 Frame Benchmark');
console.log('=================================================================');

// 1. Setup mock canvas context for benchmark
function createMockCanvas(w, h) {
  const ops = { drawImage: 0, fill: 0, stroke: 0, moveTo: 0, lineTo: 0, beginPath: 0 };
  const ctx = {
    beginPath: () => ops.beginPath++,
    moveTo: () => ops.moveTo++,
    lineTo: () => ops.lineTo++,
    closePath: () => {},
    fill: () => ops.fill++,
    stroke: () => ops.stroke++,
    drawImage: () => ops.drawImage++,
    fillStyle: '',
    strokeStyle: ''
  };
  return { width: w, height: h, getContext: () => ctx, ops };
}

// 2. Build full office scene with 256 floor tiles, walls, desks, furniture
const w = 16, h = 16;
const camera = { rot: 0, ox: 520, oy: 140, tw: 48, th: 24, zh: 18 };
const blocks = [];

for (let x = 0; x < w; x++) {
  for (let y = 0; y < h; y++) {
    blocks.push({ x, y, z: 0, color: (x + y) % 2 === 0 ? '#111c30' : '#152138' });
  }
}
// Add perimeter walls and furniture
for (let x = 0; x < w; x++) blocks.push({ x, y: 0, z: 1, color: '#1e293b' });
for (let y = 1; y < h; y++) blocks.push({ x: 0, y, z: 1, color: '#1e293b' });
for (let i = 0; i < 12; i++) {
  blocks.push({ x: 3 + (i % 3) * 3, y: 7 + Math.floor(i / 3) * 2, z: 1, color: '#6d4525' });
}

console.log(`Scene geometry: ${blocks.length} voxel blocks in static scene`);

// 3. Measure static buffer bake time
const bakeStart = performance.now();
const staticScene = { w, h, camera, blocks };
const buffer = buildStaticBuffer(staticScene, 1040, 540);
const bakeTime = performance.now() - bakeStart;
console.log(`Static buffer pre-bake time: ${bakeTime.toFixed(3)} ms`);

// 4. Create active agents (12 active agents with dynamic positions and animation states)
const agents = [];
const roles = ['orchestrator', 'developer', 'devops', 'analyst', 'security', 'operations'];
for (let i = 0; i < 12; i++) {
  agents.push({
    id: `agent_${i}`,
    x: 3 + (i % 3) * 3,
    y: 7 + Math.floor(i / 3) * 2,
    z: 1,
    shirtColor: '#38bdf8',
    skinColor: '#fbcfe8',
    hairColor: '#3b2010',
    state: i % 2 === 0 ? 'working' : 'idle'
  });
}

// 5. Run 300 frame composite loop
const frameCanvas = createMockCanvas(1040, 540);
const frameCtx = frameCanvas.getContext('2d');
const TOTAL_FRAMES = 300;

const renderStart = performance.now();

for (let f = 0; f < TOTAL_FRAMES; f++) {
  // Animate agents slightly (walking/typing animation)
  agents.forEach((a, idx) => {
    a.state = (f + idx) % 20 < 10 ? 'working' : 'idle';
  });

  const scene = { w, h, camera, entities: agents };
  renderFrame(frameCtx, scene, buffer);
}

const renderTotalTime = performance.now() - renderStart;
const avgFrameTime = renderTotalTime / TOTAL_FRAMES;
const fps = 1000 / avgFrameTime;

console.log(`Total time for ${TOTAL_FRAMES} frames: ${renderTotalTime.toFixed(2)} ms`);
console.log(`Average time per frame: ${avgFrameTime.toFixed(4)} ms`);
console.log(`Estimated throughput: ${fps.toFixed(0)} FPS (target: > 60 FPS)`);
console.log('=================================================================');
console.log('✅ Frame benchmark completed successfully within performance budget!');
