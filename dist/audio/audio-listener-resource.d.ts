import type { AudioListenerPose } from './spatial-audio-bus.js';
export type { AudioListenerPose } from './spatial-audio-bus.js';
export interface AudioListenerResource {
    pose: AudioListenerPose;
    lastUpdateFrame: number;
}
export declare const DEFAULT_LISTENER_FORWARD: {
    x: number;
    y: number;
    z: number;
};
export declare const DEFAULT_LISTENER_UP: {
    x: number;
    y: number;
    z: number;
};
export declare function createAudioListenerResource(): AudioListenerResource;
export declare const RESOURCE_AUDIO_LISTENER = "audio_listener";
//# sourceMappingURL=audio-listener-resource.d.ts.map