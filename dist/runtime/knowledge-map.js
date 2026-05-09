// KnowledgeMap - prerequisite-graph topology for learning + skill
// trees. Wave 1.5 educational MILESTONE primitive (1.5.5 capstone).
//
// ProgressTracker (1.5.4) holds per-skill mastery with Bloom-level
// granularity. KnowledgeMap is the structure that says WHICH skills
// matter and IN WHAT ORDER they should be learned. Each topic links
// to a mastery skill; prerequisite edges say "you can't unlock topic
// B until topic A's mastery passes a threshold." The pair gives you
// the standard learning-app + skill-tree + quest-dependency-graph
// pattern.
//
//   var pt = ProgressTracker.create();
//   pt.defineSkill({ id: 'arith_basic',     name: 'Basic Arithmetic' });
//   pt.defineSkill({ id: 'arith_fractions', name: 'Fractions' });
//   pt.defineSkill({ id: 'algebra_linear',  name: 'Linear Algebra' });
//
//   var km = KnowledgeMap.create({ minMasteryThreshold: 0.7 });
//   km.addTopic({ id: 't_arith_basic',     name: 'Basic',     masterySkillId: 'arith_basic' });
//   km.addTopic({ id: 't_arith_fractions', name: 'Fractions', masterySkillId: 'arith_fractions' });
//   km.addTopic({ id: 't_algebra_linear',  name: 'Algebra',   masterySkillId: 'algebra_linear' });
//   km.addPrerequisite('t_arith_basic',     't_arith_fractions');
//   km.addPrerequisite('t_arith_fractions', 't_algebra_linear');
//
//   // Has the player practiced enough basic arith to unlock fractions?
//   if (km.isUnlocked('t_arith_fractions', pt)) showFractionsContent();
//
//   // Order to teach a brand-new student to reach 'algebra':
//   var path = km.learningPath('t_algebra_linear');
//   // -> ['t_arith_basic', 't_arith_fractions', 't_algebra_linear']
//
// Pairs with ProgressTracker (1.5.4, the mastery source),
// QuestionBank (1.5.3, evidence per topic), GraphLayout (1.5.2,
// renders the prereq DAG), TimelineLedger (1.5.1, when topics
// unlocked).
//
// Code style: var-only in browser source.
function clamp01(v) {
    if (!isFinite(v))
        return 0;
    if (v < 0)
        return 0;
    if (v > 1)
        return 1;
    return v;
}
export class KnowledgeMap {
    topics = new Map();
    defaultThreshold;
    disposed = false;
    constructor(opts) {
        var t = opts.minMasteryThreshold;
        this.defaultThreshold = (typeof t === 'number' && isFinite(t))
            ? clamp01(t) : 0.7;
    }
    static create(opts = {}) {
        return new KnowledgeMap(opts);
    }
    // ---------- topic CRUD ----------
    addTopic(spec) {
        if (this.disposed)
            return false;
        if (!spec || typeof spec.id !== 'string' || spec.id.length === 0)
            return false;
        if (typeof spec.name !== 'string')
            return false;
        if (this.topics.has(spec.id))
            return false;
        var clone = { id: spec.id, name: spec.name };
        if (spec.masterySkillId !== undefined)
            clone.masterySkillId = spec.masterySkillId;
        if (spec.data !== undefined)
            clone.data = spec.data;
        this.topics.set(spec.id, {
            spec: clone,
            incoming: [],
            outgoing: [],
        });
        return true;
    }
    hasTopic(id) {
        return this.topics.has(id);
    }
    getTopic(id) {
        var t = this.topics.get(id);
        return t ? this.snapshot(t) : null;
    }
    removeTopic(id) {
        if (this.disposed)
            return false;
        var t = this.topics.get(id);
        if (!t)
            return false;
        // Drop incoming + outgoing edges from neighbor lists.
        for (var i = 0; i < t.incoming.length; i++) {
            var inc = t.incoming[i];
            var src = this.topics.get(inc.prerequisiteId);
            if (src) {
                src.outgoing = src.outgoing.filter(function (e) { return e.dependentId !== id; });
            }
        }
        for (var j = 0; j < t.outgoing.length; j++) {
            var out = t.outgoing[j];
            var dst = this.topics.get(out.dependentId);
            if (dst) {
                dst.incoming = dst.incoming.filter(function (e) { return e.prerequisiteId !== id; });
            }
        }
        this.topics.delete(id);
        return true;
    }
    topics$() {
        var out = [];
        var iter = this.topics.values();
        var v = iter.next();
        while (!v.done) {
            out.push(this.snapshot(v.value));
            v = iter.next();
        }
        return out;
    }
    // 'topics' clashes with the private field; expose as list().
    list() {
        return this.topics$();
    }
    count() { return this.topics.size; }
    // ---------- prerequisite CRUD ----------
    // Add a directed edge: dependentId requires prerequisiteId at
    // threshold. Returns false if either topic is missing, the edge
    // already exists, or the edge would create a cycle.
    addPrerequisite(prerequisiteId, dependentId, threshold) {
        if (this.disposed)
            return false;
        if (prerequisiteId === dependentId)
            return false;
        var src = this.topics.get(prerequisiteId);
        var dst = this.topics.get(dependentId);
        if (!src || !dst)
            return false;
        // Already exists?
        for (var i = 0; i < dst.incoming.length; i++) {
            if (dst.incoming[i].prerequisiteId === prerequisiteId)
                return false;
        }
        var t;
        if (typeof threshold === 'number' && isFinite(threshold)) {
            t = clamp01(threshold);
        }
        else {
            t = this.defaultThreshold;
        }
        var edge = { prerequisiteId: prerequisiteId, dependentId: dependentId, threshold: t };
        // Cycle check: is there a path from dependentId to prerequisiteId?
        if (this.pathExists(dependentId, prerequisiteId))
            return false;
        src.outgoing.push(edge);
        dst.incoming.push(edge);
        return true;
    }
    removePrerequisite(prerequisiteId, dependentId) {
        if (this.disposed)
            return false;
        var src = this.topics.get(prerequisiteId);
        var dst = this.topics.get(dependentId);
        if (!src || !dst)
            return false;
        var beforeSrc = src.outgoing.length;
        src.outgoing = src.outgoing.filter(function (e) { return e.dependentId !== dependentId; });
        dst.incoming = dst.incoming.filter(function (e) { return e.prerequisiteId !== prerequisiteId; });
        return src.outgoing.length < beforeSrc;
    }
    prerequisitesOf(topicId) {
        var t = this.topics.get(topicId);
        if (!t)
            return [];
        var out = [];
        for (var i = 0; i < t.incoming.length; i++) {
            var e = t.incoming[i];
            out.push({ prerequisiteId: e.prerequisiteId, threshold: e.threshold });
        }
        return out;
    }
    dependentsOf(topicId) {
        var t = this.topics.get(topicId);
        if (!t)
            return [];
        var out = [];
        for (var i = 0; i < t.outgoing.length; i++) {
            out.push(t.outgoing[i].dependentId);
        }
        return out;
    }
    // ---------- mastery / unlock ----------
    // Read mastery for a topic from the supplied source. 0..1.
    // Topics without a masterySkillId or with a missing skill return 0.
    getMastery(topicId, src) {
        var t = this.topics.get(topicId);
        if (!t || !t.spec.masterySkillId)
            return 0;
        if (!src || typeof src.getSkill !== 'function')
            return 0;
        var skill = src.getSkill(t.spec.masterySkillId);
        if (!skill)
            return 0;
        return clamp01(skill.overallMastery);
    }
    // True iff every prerequisite edge is satisfied
    // (prerequisite mastery >= edge threshold).
    // Topics with NO prerequisites are always unlocked.
    isUnlocked(topicId, src) {
        var t = this.topics.get(topicId);
        if (!t)
            return false;
        if (t.incoming.length === 0)
            return true;
        for (var i = 0; i < t.incoming.length; i++) {
            var e = t.incoming[i];
            var m = this.getMastery(e.prerequisiteId, src);
            if (m < e.threshold)
                return false;
        }
        return true;
    }
    unlocked(src) {
        var out = [];
        var iter = this.topics.keys();
        var v = iter.next();
        while (!v.done) {
            if (this.isUnlocked(v.value, src))
                out.push(v.value);
            v = iter.next();
        }
        return out;
    }
    locked(src) {
        var out = [];
        var iter = this.topics.keys();
        var v = iter.next();
        while (!v.done) {
            if (!this.isUnlocked(v.value, src))
                out.push(v.value);
            v = iter.next();
        }
        return out;
    }
    // Topo-sort of transitive prerequisites into teaching order.
    // Returns ids in the order a learner should master them, ending
    // with targetTopicId. Returns null if the target is missing or
    // the graph contains a cycle reachable from the target.
    learningPath(targetTopicId) {
        if (!this.topics.has(targetTopicId))
            return null;
        var WHITE = 0, GRAY = 1, BLACK = 2;
        var color = new Map();
        var order = [];
        var cycle = false;
        var self = this;
        function visit(id) {
            if (cycle)
                return;
            var c = color.get(id);
            if (c === GRAY) {
                cycle = true;
                return;
            }
            if (c === BLACK)
                return;
            color.set(id, GRAY);
            var t = self.topics.get(id);
            if (t) {
                for (var i = 0; i < t.incoming.length; i++) {
                    visit(t.incoming[i].prerequisiteId);
                    if (cycle)
                        return;
                }
            }
            color.set(id, BLACK);
            order.push(id);
        }
        visit(targetTopicId);
        if (cycle)
            return null;
        return order;
    }
    clear() {
        if (this.disposed)
            return;
        this.topics.clear();
    }
    dispose() {
        this.topics.clear();
        this.disposed = true;
    }
    // ---------- private helpers ----------
    snapshot(t) {
        var prereqs = [];
        for (var i = 0; i < t.incoming.length; i++) {
            var e = t.incoming[i];
            prereqs.push({ prerequisiteId: e.prerequisiteId, threshold: e.threshold });
        }
        var out = {
            id: t.spec.id,
            name: t.spec.name,
            prerequisites: prereqs,
        };
        if (t.spec.masterySkillId !== undefined)
            out.masterySkillId = t.spec.masterySkillId;
        if (t.spec.data !== undefined)
            out.data = t.spec.data;
        return out;
    }
    // BFS: is there a path from `from` to `to` along outgoing edges?
    pathExists(from, to) {
        if (from === to)
            return true;
        var seen = new Set();
        var queue = [from];
        while (queue.length > 0) {
            var cur = queue.shift();
            if (cur === to)
                return true;
            if (seen.has(cur))
                continue;
            seen.add(cur);
            var t = this.topics.get(cur);
            if (!t)
                continue;
            for (var i = 0; i < t.outgoing.length; i++) {
                var nxt = t.outgoing[i].dependentId;
                if (!seen.has(nxt))
                    queue.push(nxt);
            }
        }
        return false;
    }
}
// Resource key for the world's resource registry.
export const RESOURCE_KNOWLEDGE_MAP = 'knowledge_map';
//# sourceMappingURL=knowledge-map.js.map