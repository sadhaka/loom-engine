// Loom Engine - Dialogue-Mini example.
//
// A turn-based branching dialogue tree. No combat, no movement; the
// engine here is only used as a state container + render loop driver.
// Demonstrates that the same ECS / resource / system model that runs
// the action-game demos also fits a UI-only game (visual novel,
// in-conversation menu, story-driven prologue, etc).
//
// Demonstrates:
//   - Custom Resource (DialogueState) registered into ResourceRegistry
//   - Custom System (DialogueRenderSystem) advancing the state in
//     response to InputSnapshot AND DOM events
//   - DOM overlay as the primary UI - the canvas only renders an
//     ambient avatar that swaps with the active speaker
import { Engine, InputSystem, RESOURCE_INPUT, SYSTEM_PHASE_INPUT, SYSTEM_PHASE_LOGIC, } from '@sadhaka/loom-engine';
const canvas = document.getElementById('stage');
const speakerEl = document.getElementById('speaker');
const lineEl = document.getElementById('line');
const choicesEl = document.getElementById('choices');
const TREE = {
    start: {
        speaker: 'Loom',
        speakerColor: '#c88cff',
        line: 'You arrived between hours. Three doors stand. Which do you push?',
        choices: [
            { label: 'The iron-red door (will).', next: 'red' },
            { label: 'The teal door (insight).', next: 'teal' },
            { label: 'The violet door (memory).', next: 'violet' },
        ],
    },
    red: {
        speaker: 'Loom',
        speakerColor: '#b04a24',
        line: 'You push and it swings inward without weight. A workshop, half-built. A hammer waits.',
        choices: [
            { label: 'Pick up the hammer.', next: 'end_will' },
            { label: 'Step back and choose again.', next: 'start' },
        ],
    },
    teal: {
        speaker: 'Loom',
        speakerColor: '#5ac9d6',
        line: 'You push and it swings open onto a library that is also a tide. Books drift.',
        choices: [
            { label: 'Read the open page.', next: 'end_insight' },
            { label: 'Step back and choose again.', next: 'start' },
        ],
    },
    violet: {
        speaker: 'Loom',
        speakerColor: '#9b5de5',
        line: 'You push and it does not swing. It dissolves. You are inside a memory you do not recognize.',
        choices: [
            { label: 'Stay until you do.', next: 'end_memory' },
            { label: 'Step back and choose again.', next: 'start' },
        ],
    },
    end_will: {
        speaker: 'Loom',
        speakerColor: '#ffd86a',
        line: 'You took the hammer. The Loom marks you. Restart?',
        choices: [{ label: 'Begin again.', next: 'start' }],
    },
    end_insight: {
        speaker: 'Loom',
        speakerColor: '#ffd86a',
        line: 'You read the page. You will remember this without trying. Restart?',
        choices: [{ label: 'Begin again.', next: 'start' }],
    },
    end_memory: {
        speaker: 'Loom',
        speakerColor: '#ffd86a',
        line: 'You stayed. The memory becomes yours. Restart?',
        choices: [{ label: 'Begin again.', next: 'start' }],
    },
};
const RESOURCE_DIALOGUE = 'dialogue';
// Keyboard input runs through the engine's InputSnapshot. DOM clicks
// run via the choices array, which sets a pending pick. The system
// applies whichever lands first this tick, then re-renders.
class DialogueSystem {
    name = 'dialogue';
    renderedNode = '';
    pendingNext = null;
    update(world, _dt) {
        const state = world.resources.require(RESOURCE_DIALOGUE);
        const input = world.resources.get(RESOURCE_INPUT);
        const node = TREE[state.nodeId];
        if (!node)
            return;
        if (input) {
            // Number keys 1..3 pick the matching choice.
            for (let k = 0; k < node.choices.length && k < 3; k++) {
                const code = 'Digit' + (k + 1);
                if (input.keysPressedThisFrame.has(code)) {
                    this.pendingNext = node.choices[k]?.next ?? null;
                }
            }
        }
        if (this.pendingNext) {
            state.nodeId = this.pendingNext;
            this.pendingNext = null;
        }
        if (state.nodeId === this.renderedNode)
            return;
        this.renderedNode = state.nodeId;
        this.render(state.nodeId);
    }
    render(nodeId) {
        const node = TREE[nodeId];
        if (!node)
            return;
        speakerEl.textContent = node.speaker;
        speakerEl.style.color = node.speakerColor;
        lineEl.textContent = node.line;
        choicesEl.innerHTML = '';
        node.choices.forEach((c, i) => {
            const btn = document.createElement('button');
            btn.textContent = '[' + (i + 1) + '] ' + c.label;
            btn.className = 'choice';
            btn.addEventListener('click', () => { this.pendingNext = c.next; });
            choicesEl.appendChild(btn);
        });
        // Repaint avatar with the speaker color.
        paintAvatar(node.speakerColor);
    }
}
function paintAvatar(hex) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, 60, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#14110d';
    ctx.lineWidth = 4;
    ctx.stroke();
}
(function boot() {
    const engine = Engine.create({ canvas });
    const resources = engine.world.resources;
    resources.set(RESOURCE_DIALOGUE, { nodeId: 'start' });
    engine.world.addSystem(new InputSystem(), SYSTEM_PHASE_INPUT);
    engine.world.addSystem(new DialogueSystem(), SYSTEM_PHASE_LOGIC);
    function tick(now) { engine.tick(now); requestAnimationFrame(tick); }
    requestAnimationFrame(tick);
})();
//# sourceMappingURL=main.js.map