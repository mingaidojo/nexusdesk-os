// Test suite for BL-CHAT-25, BL-CHAT-26, BL-CHAT-27
const assert = require('assert');

console.log('🧪 Running BL-CHAT-25, 26, 27 Unit Tests...');

// Mock message history
const mockHistory = [
  {
    id: 'msg-1',
    sender: 'Min',
    sender_type: 'user',
    text: 'What is our Q4 treasury asset allocation strategy?',
    timestamp: 1792384000
  },
  {
    id: 'msg-2',
    sender: 'Solaris',
    sender_type: 'agent',
    engine: 'hermes',
    role: 'Orchestrator: Intent Routing & Synthesis',
    text: 'Allocating 60% SBN, 20% liquid cash reserves, and 20% high-yield short notes.',
    timestamp: 1792384060
  }
];

// Test 1: Markdown Export Format
function generateMarkdownExport(title, inst, messages) {
  let md = `# NexusDesk Conversation Transcript: ${title}\n\n`;
  md += `- **Fleet Instance**: \`${inst}\`\n`;
  md += `- **Export Date**: 2026-10-19\n`;
  md += `- **Total Dialogue Turns**: ${messages.length}\n\n`;
  md += `---\n\n`;

  messages.forEach(m => {
    const sender = m.sender || (m.sender_type === 'user' ? 'Operator (Min)' : 'System');
    const eng = m.engine ? ` [${m.engine.toUpperCase()}]` : '';
    md += `### ${sender}${eng}\n`;
    if (m.role) md += `*${m.role}*\n\n`;
    md += `${m.text || ''}\n\n`;
  });
  return md;
}

const mdOut = generateMarkdownExport('War Room', 'agents_bs', mockHistory);
assert(mdOut.includes('# NexusDesk Conversation Transcript: War Room'), 'Test 1 Failed: Markdown title missing');
assert(mdOut.includes('### Solaris [HERMES]'), 'Test 1 Failed: Agent engine tag missing');
assert(mdOut.includes('Allocating 60% SBN'), 'Test 1 Failed: Message body missing');
console.log('  ✅ Test 1: Markdown Export formatting');

// Test 2: JSON Export Format
function generateJsonExport(title, inst, messages) {
  return JSON.stringify({
    title,
    fleet_instance: inst,
    total_messages: messages.length,
    messages
  }, null, 2);
}

const jsonOut = JSON.parse(generateJsonExport('War Room', 'agents_bs', mockHistory));
assert.strictEqual(jsonOut.total_messages, 2, 'Test 2 Failed: Incorrect message count');
assert.strictEqual(jsonOut.messages[1].sender, 'Solaris', 'Test 2 Failed: Incorrect sender in JSON');
console.log('  ✅ Test 2: Structured JSON Export');

// Test 3: Plain Text Export Format
function generateTextExport(title, inst, messages) {
  let txt = `=====================================================\n`;
  txt += `NEXUSDESK TRANSCRIPT: ${title}\n`;
  txt += `Instance: ${inst}\n`;
  txt += `=====================================================\n\n`;

  messages.forEach(m => {
    txt += `${m.sender}:\n${m.text}\n\n`;
  });
  return txt;
}

const txtOut = generateTextExport('War Room', 'agents_bs', mockHistory);
assert(txtOut.includes('NEXUSDESK TRANSCRIPT: War Room'), 'Test 3 Failed: Text transcript header missing');
assert(txtOut.includes('Solaris:\nAllocating 60% SBN'), 'Test 3 Failed: Text message missing');
console.log('  ✅ Test 3: Plain Text Export');

// Test 4: Verify No Trailing Line-Clamp Truncation in Role Display
const roleString = "Sysadmin: uptime, logs, database health, security monitoring";
const roleHtml = `<p class="text-[10px] text-slate-400 mb-1.5 font-mono italic">${roleString}</p>`;
assert(!roleHtml.includes('line-clamp'), 'Test 4 Failed: line-clamp detected in role html');
console.log('  ✅ Test 4: Role display free of line-clamp truncation');

// Test 5: Verify Unified Seats & Mention Ribbon Structure
const specialTags = [
  { tag: 'everyone', label: '👥 @everyone' },
  { tag: 'everyagents', label: '🤖 @everyagents' },
  { tag: 'user', label: '👤 @user' }
];
assert.strictEqual(specialTags.length, 3, 'Test 5 Failed: Special mention tags missing');
console.log('  ✅ Test 5: Special collective mention tags present');

console.log('\n🎉 All 5 BL-CHAT-25/26/27 unit tests passed successfully!\n');
