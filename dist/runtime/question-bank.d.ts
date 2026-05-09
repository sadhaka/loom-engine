export interface QuestionItem<T = Record<string, unknown>> {
    id: string;
    prompt: string;
    answers?: string[];
    correct?: number | string;
    tags?: string[];
    data?: T;
}
export interface ReviewState {
    itemId: string;
    easeFactor: number;
    intervalDays: number;
    repetitions: number;
    nextReviewAt: number;
    lastReviewAt: number;
    totalReviews: number;
    lastRating: number;
}
export interface DueOptions {
    now?: number;
    limit?: number;
    tag?: string;
}
export interface QuestionBankOptions {
    now?: () => number;
    initialEaseFactor?: number;
    minEaseFactor?: number;
}
export declare class QuestionBank<T = Record<string, unknown>> {
    private items;
    private nowFn;
    private initialEase;
    private minEase;
    private disposed;
    private constructor();
    static create<T = Record<string, unknown>>(opts?: QuestionBankOptions): QuestionBank<T>;
    add(item: QuestionItem<T>): boolean;
    remove(id: string): boolean;
    has(id: string): boolean;
    get(id: string): QuestionItem<T> | null;
    reviewState(id: string): ReviewState | null;
    count(): number;
    due(opts?: DueOptions): QuestionItem<T>[];
    review(itemId: string, rating: number, now?: number): ReviewState | null;
    skip(itemId: string, now?: number): boolean;
    reset(itemId: string, now?: number): boolean;
    byTag(tag: string): QuestionItem<T>[];
    list(): QuestionItem<T>[];
    totalReviews(): number;
    unreviewed(): QuestionItem<T>[];
    clear(): void;
    dispose(): void;
    private cloneItem;
}
export declare const RESOURCE_QUESTION_BANK = "question_bank";
//# sourceMappingURL=question-bank.d.ts.map