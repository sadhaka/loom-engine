export interface BenchmarkSpec {
    name: string;
    fn: () => void;
    warmup?: number;
    iterations?: number;
    beforeEach?: () => void;
    afterEach?: () => void;
}
export interface BenchmarkResult {
    name: string;
    iterations: number;
    durations: number[];
    meanMs: number;
    medianMs: number;
    minMs: number;
    maxMs: number;
    p95Ms: number;
    totalMs: number;
    errorCount: number;
    recordedAt: number;
}
export interface BenchmarkBaseline {
    name: string;
    meanMs: number;
    medianMs: number;
    p95Ms: number;
    iterations: number;
    recordedAt: number;
}
export interface RegressionReport {
    name: string;
    baseline: BenchmarkBaseline | null;
    current: BenchmarkResult;
    ratio: number;
    isRegression: boolean;
    threshold: number;
}
export interface BaselineStorage {
    saveAll(map: Record<string, BenchmarkBaseline>): void;
    loadAll(): Record<string, BenchmarkBaseline>;
}
export interface BenchmarkHarnessOptions {
    now?: () => number;
    defaultWarmup?: number;
    defaultIterations?: number;
    storage?: BaselineStorage;
    regressionThreshold?: number;
}
export declare class BenchmarkHarness {
    private specs;
    private baselines;
    private nowMs;
    private defaultWarmup;
    private defaultIterations;
    private storage;
    private regressionThreshold;
    private disposed;
    private constructor();
    static create(opts?: BenchmarkHarnessOptions): BenchmarkHarness;
    register(spec: BenchmarkSpec): boolean;
    unregister(name: string): boolean;
    has(name: string): boolean;
    list(): string[];
    run(name: string): BenchmarkResult;
    runAll(): BenchmarkResult[];
    setBaseline(name: string, source: BenchmarkResult | BenchmarkBaseline): boolean;
    getBaseline(name: string): BenchmarkBaseline | null;
    hasBaseline(name: string): boolean;
    clearBaseline(name: string): boolean;
    saveBaselines(): boolean;
    loadBaselines(): boolean;
    detectRegression(result: BenchmarkResult, threshold?: number): RegressionReport;
    dispose(): void;
    private runSpec;
    private invokeOnce;
}
export declare const RESOURCE_BENCHMARK_HARNESS = "benchmark_harness";
//# sourceMappingURL=benchmark-harness.d.ts.map