import type { DirectorEvent } from '../event-envelope.js';
import type { IAIPlugin, EmittedEvents, PluginContext, ZoneEvent } from './plugin.js';
export interface MockAIPluginScriptEntry {
    atTick: number;
    characterEvents?: DirectorEvent[];
    zoneEvents?: ZoneEvent[];
}
export interface MockAIPluginOptions {
    name?: string;
    script: ReadonlyArray<MockAIPluginScriptEntry>;
    priority?: number;
}
export declare class MockAIPlugin implements IAIPlugin {
    readonly name: string;
    readonly version = "0.0.1";
    readonly priority: number;
    private readonly script;
    private tick;
    constructor(opts: MockAIPluginOptions);
    onTick(_ctx: PluginContext): Promise<EmittedEvents>;
    currentTick(): number;
    resetTick(): void;
}
//# sourceMappingURL=mock-ai-plugin.d.ts.map