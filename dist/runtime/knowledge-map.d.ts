export interface TopicSpec<T = Record<string, unknown>> {
    id: string;
    name: string;
    masterySkillId?: string;
    data?: T;
}
export interface PrerequisiteEdge {
    prerequisiteId: string;
    threshold: number;
}
export interface TopicState<T = Record<string, unknown>> {
    id: string;
    name: string;
    masterySkillId?: string;
    prerequisites: PrerequisiteEdge[];
    data?: T;
}
export interface MasterySource {
    getSkill(id: string): {
        overallMastery: number;
    } | null;
}
export interface KnowledgeMapOptions {
    minMasteryThreshold?: number;
}
export declare class KnowledgeMap<T = Record<string, unknown>> {
    private topics;
    private defaultThreshold;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: KnowledgeMapOptions): KnowledgeMap<T>;
    addTopic(spec: TopicSpec<T>): boolean;
    hasTopic(id: string): boolean;
    getTopic(id: string): TopicState<T> | null;
    removeTopic(id: string): boolean;
    topics$(): TopicState<T>[];
    list(): TopicState<T>[];
    count(): number;
    addPrerequisite(prerequisiteId: string, dependentId: string, threshold?: number): boolean;
    removePrerequisite(prerequisiteId: string, dependentId: string): boolean;
    prerequisitesOf(topicId: string): PrerequisiteEdge[];
    dependentsOf(topicId: string): string[];
    getMastery(topicId: string, src: MasterySource): number;
    isUnlocked(topicId: string, src: MasterySource): boolean;
    unlocked(src: MasterySource): string[];
    locked(src: MasterySource): string[];
    learningPath(targetTopicId: string): string[] | null;
    clear(): void;
    dispose(): void;
    private snapshot;
    private pathExists;
}
export declare const RESOURCE_KNOWLEDGE_MAP = "knowledge_map";
//# sourceMappingURL=knowledge-map.d.ts.map