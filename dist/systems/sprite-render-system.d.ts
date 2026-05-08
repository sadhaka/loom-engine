import type { System } from '../system.js';
import type { World } from '../world.js';
export declare class SpriteRenderSystem implements System {
    readonly name: string;
    private sortBuffer;
    private scratchTint;
    update(world: World, _dt: number): void;
}
//# sourceMappingURL=sprite-render-system.d.ts.map