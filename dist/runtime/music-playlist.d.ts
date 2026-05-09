export interface MusicTrack {
    id: string;
    url: string;
    durationMs?: number;
    loop?: boolean;
    data?: Record<string, unknown>;
}
export interface MusicPlaylistOptions {
    loopAtEnd?: boolean;
    shuffleOnLoop?: boolean;
    rng?: () => number;
}
export declare class MusicPlaylist {
    private tracks;
    private order;
    private cursor;
    private playing;
    private loopAtEnd;
    private shuffleOnLoop;
    private rng;
    private disposed;
    private constructor();
    static create(opts?: MusicPlaylistOptions): MusicPlaylist;
    addTrack(track: MusicTrack): boolean;
    removeTrack(id: string): boolean;
    has(id: string): boolean;
    size(): number;
    list(): MusicTrack[];
    play(): MusicTrack | null;
    next(): MusicTrack | null;
    prev(): MusicTrack | null;
    stop(): void;
    jumpTo(id: string): MusicTrack | null;
    current(): MusicTrack | null;
    isPlaying(): boolean;
    setLoopAtEnd(loop: boolean): void;
    setShuffleOnLoop(shuffle: boolean): void;
    shuffle(): void;
    dispose(): void;
    private currentInternal;
    private shuffleOrder;
}
export declare const RESOURCE_MUSIC_PLAYLIST = "music_playlist";
//# sourceMappingURL=music-playlist.d.ts.map