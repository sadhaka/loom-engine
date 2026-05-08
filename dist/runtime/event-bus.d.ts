export type EventHandler<T = unknown> = (data: T) => void;
export declare class EventBus {
    private subscribers;
    private nextId;
    private publishCount;
    private deliveredCount;
    subscribe<T = unknown>(topic: string, handler: EventHandler<T>): () => void;
    once<T = unknown>(topic: string, handler: EventHandler<T>): () => void;
    private add;
    publish<T = unknown>(topic: string, data?: T): void;
    off(topic: string): void;
    clear(): void;
    topics(): string[];
    handlerCount(topic: string): number;
    stats(): {
        publishCount: number;
        deliveredCount: number;
        topicCount: number;
    };
}
export declare const RESOURCE_EVENT_BUS = "loom.event_bus";
//# sourceMappingURL=event-bus.d.ts.map