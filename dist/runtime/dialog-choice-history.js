// DialogChoiceHistory - record + replay dialog choices.
//
// 0.89.0 enabling primitive. DialogTree (0.61) tracks current branch
// position; DialogChoiceHistory records the ledger of every choice
// the player made over time. Use cases: branching visualization
// ("here's the path you took"), "I've already heard this pitch"
// detection, replay verification, analytics, and quest gating
// ("you chose to spare him in chapter 1, the bandits remember").
//
//   var history = DialogChoiceHistory.create();
//   history.record('mira-intro', 1, 'Take the quest');
//   history.has('mira-intro', 1); // true
//   history.lastChoice('mira-intro')?.choiceIndex; // 1
//
// Pairs with DialogTree (0.61) and EventLog (0.83) (DialogChoice
// records are a specialized event shape; consumers may also pipe
// them into the generic EventLog if they want them in the timeline).
//
// Code style: var-only in browser source.
const DEFAULT_CAPACITY = 10000;
export class DialogChoiceHistory {
    records = [];
    capacityNum;
    nextSeq = 1;
    disposed = false;
    constructor(opts) {
        this.capacityNum = opts.capacity !== undefined && isFinite(opts.capacity) && opts.capacity > 0
            ? Math.floor(opts.capacity) : DEFAULT_CAPACITY;
    }
    static create(opts = {}) {
        return new DialogChoiceHistory(opts);
    }
    record(nodeId, choiceIndex, choiceLabel) {
        if (this.disposed)
            return false;
        if (typeof nodeId !== 'string' || nodeId.length === 0)
            return false;
        if (typeof choiceIndex !== 'number' || !isFinite(choiceIndex) || choiceIndex < 0)
            return false;
        var rec = {
            nodeId: nodeId,
            choiceIndex: Math.floor(choiceIndex),
            seq: this.nextSeq++,
        };
        if (choiceLabel !== undefined)
            rec.choiceLabel = choiceLabel;
        this.records.push(rec);
        if (this.records.length > this.capacityNum)
            this.records.shift();
        return true;
    }
    byNode(nodeId) {
        var out = [];
        for (var i = 0; i < this.records.length; i++) {
            var r = this.records[i];
            if (r.nodeId === nodeId)
                out.push(cloneRecord(r));
        }
        return out;
    }
    lastChoice(nodeId) {
        for (var i = this.records.length - 1; i >= 0; i--) {
            var r = this.records[i];
            if (r.nodeId === nodeId)
                return cloneRecord(r);
        }
        return null;
    }
    has(nodeId, choiceIndex) {
        for (var i = 0; i < this.records.length; i++) {
            var r = this.records[i];
            if (r.nodeId === nodeId && r.choiceIndex === choiceIndex)
                return true;
        }
        return false;
    }
    count(nodeId, choiceIndex) {
        var n = 0;
        for (var i = 0; i < this.records.length; i++) {
            var r = this.records[i];
            if (r.nodeId === nodeId && r.choiceIndex === choiceIndex)
                n++;
        }
        return n;
    }
    countByNode(nodeId) {
        var n = 0;
        for (var i = 0; i < this.records.length; i++) {
            if (this.records[i].nodeId === nodeId)
                n++;
        }
        return n;
    }
    totalCount() { return this.records.length; }
    capacity() { return this.capacityNum; }
    list() {
        return this.records.map(cloneRecord);
    }
    clear() {
        if (this.disposed)
            return;
        this.records = [];
    }
    toSnapshot() {
        return this.list();
    }
    fromSnapshot(records) {
        if (this.disposed)
            return;
        if (!Array.isArray(records))
            return;
        this.records = [];
        var maxSeq = 0;
        for (var i = 0; i < records.length; i++) {
            var r = records[i];
            if (!r || typeof r !== 'object')
                continue;
            if (typeof r.nodeId !== 'string' || r.nodeId.length === 0)
                continue;
            if (typeof r.choiceIndex !== 'number' || !isFinite(r.choiceIndex) || r.choiceIndex < 0)
                continue;
            if (typeof r.seq !== 'number' || !isFinite(r.seq) || r.seq <= 0)
                continue;
            var rec = {
                nodeId: r.nodeId,
                choiceIndex: Math.floor(r.choiceIndex),
                seq: r.seq,
            };
            if (r.choiceLabel !== undefined)
                rec.choiceLabel = r.choiceLabel;
            this.records.push(rec);
            if (rec.seq > maxSeq)
                maxSeq = rec.seq;
        }
        this.nextSeq = maxSeq + 1;
        while (this.records.length > this.capacityNum)
            this.records.shift();
    }
    dispose() {
        this.records = [];
        this.disposed = true;
    }
}
function cloneRecord(r) {
    var copy = { nodeId: r.nodeId, choiceIndex: r.choiceIndex, seq: r.seq };
    if (r.choiceLabel !== undefined)
        copy.choiceLabel = r.choiceLabel;
    return copy;
}
// Resource key for the world's resource registry.
export const RESOURCE_DIALOG_CHOICE_HISTORY = 'dialog_choice_history';
//# sourceMappingURL=dialog-choice-history.js.map