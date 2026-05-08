// ZoneCatalog - data table of zone configurations.
//
// Each zone entry describes the rendering hints (tile palette, mood,
// ambient audio bus level), the NPCs that live there, and the
// connections to other zones. Phase 8 v1 ships 2 zones:
//
//   lastlight_plaza   - Act 1 convergence hub. Misha Dev greets the
//                       player. Portal connects to iron_reach.
//   iron_reach        - Strknot starter zone. Forge-city aesthetic,
//                       smoke-stained stone palette, no NPCs in v1
//                       beyond the return portal back to Plaza.
//
// Per LOOM-CLASS-SYSTEM-SPEC Section 3, the other 5 knot zones
// (saltsprig, the_archive, hammerwash, crystwell, forge_archive,
// centerknot_crossroads) get their own entries in subsequent
// sessions as the spec ships them.
import { hexToRgba } from '../util/color.js';
export const ZONE_CATALOG = {
    lastlight_plaza: {
        id: 'lastlight_plaza',
        name: 'Lastlight Plaza',
        knot: 'center',
        palette: {
            fill: hexToRgba(0x3a3a4e), // muted lavender-grey stone
            stroke: hexToRgba(0x6a6a8a),
            highlight: hexToRgba(0x9a9aba),
        },
        musicLevel: 0.6,
        exits: ['iron_reach'],
    },
    iron_reach: {
        id: 'iron_reach',
        name: 'Iron Reach',
        knot: 'str',
        palette: {
            fill: hexToRgba(0x4a2418), // smoke-stained brick
            stroke: hexToRgba(0x804020),
            highlight: hexToRgba(0xc06030),
        },
        musicLevel: 0.9,
        exits: ['lastlight_plaza'],
    },
    saltsprig: {
        id: 'saltsprig',
        name: 'Saltsprig',
        knot: 'dex',
        palette: {
            fill: hexToRgba(0x1a4a52),
            stroke: hexToRgba(0x2a8c95),
            highlight: hexToRgba(0x5ac9d6),
        },
        musicLevel: 0.7,
        exits: ['lastlight_plaza'],
    },
    the_archive: {
        id: 'the_archive',
        name: 'The Archive',
        knot: 'int',
        palette: {
            fill: hexToRgba(0x2a1a3a),
            stroke: hexToRgba(0x603b91),
            highlight: hexToRgba(0x9b5de5),
        },
        musicLevel: 0.5,
        exits: ['lastlight_plaza'],
    },
    hammerwash: {
        id: 'hammerwash',
        name: 'Hammerwash',
        knot: 'mixed',
        palette: {
            fill: hexToRgba(0x3a3030),
            stroke: hexToRgba(0x5a4040),
            highlight: hexToRgba(0xa07060),
        },
        musicLevel: 0.8,
        exits: ['lastlight_plaza'],
    },
    crystwell: {
        id: 'crystwell',
        name: 'Crystwell',
        knot: 'mixed',
        palette: {
            fill: hexToRgba(0x1a3a4a),
            stroke: hexToRgba(0x456080),
            highlight: hexToRgba(0x80a0c8),
        },
        musicLevel: 0.7,
        exits: ['lastlight_plaza'],
    },
    forge_archive: {
        id: 'forge_archive',
        name: 'Forge-Archive',
        knot: 'mixed',
        palette: {
            fill: hexToRgba(0x3a2030),
            stroke: hexToRgba(0x6b3050),
            highlight: hexToRgba(0xa86090),
        },
        musicLevel: 0.7,
        exits: ['lastlight_plaza'],
    },
    centerknot_crossroads: {
        id: 'centerknot_crossroads',
        name: 'Centerknot Crossroads',
        knot: 'center',
        palette: {
            fill: hexToRgba(0x2a2a30),
            stroke: hexToRgba(0x6a6a40),
            highlight: hexToRgba(0xffd86a),
        },
        musicLevel: 0.6,
        exits: ['lastlight_plaza'],
    },
};
//# sourceMappingURL=zone-catalog.js.map