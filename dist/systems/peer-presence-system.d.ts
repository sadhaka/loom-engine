import type { System } from '../system.js';
import type { World } from '../world.js';
export declare class PeerPresenceSystem implements System {
    readonly name: string;
    update(world: World, _dt: number): void;
}
export declare class PeerRenderSystem implements System {
    readonly name: string;
    private scratchTextStyle;
    private scratchTint;
    private readonly labelYOffset;
    private readonly showNames;
    constructor(opts?: {
        labelYOffset?: number;
        showNames?: boolean;
    });
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=peer-presence-system.d.ts.map