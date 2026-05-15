// LoomPulse - the player-vibe inference kernel: per-vibe Q16.16
// fixed-point EMA accumulators with hysteresis bands, confidence
// decay, double-buffered output, an explicit consent kill switch,
// and a deliberately-narrow output surface so that inferred emotion
// CANNOT directly feed permanent reputation.
//
// The Trinity dossier's section 19 (Gemini Volume I). The Gemini sketch
// was `injectSignal(signalType, intensity) { acc[signalType] =
// acc[signalType] * 0.9 + intensity * 0.1 }`. The Codex audit:
// "ethically high-risk and technically noisy." The sketch had no
// consent gate (a player who never opted in still got profiled), no
// confidence (a single signal at frame 1 produced a fully-confident
// "vibe"), no hysteresis (any zero-crossing flickered the UI), no
// double-buffering (the consumer race-read mid-update), no
// reputation isolation (a downstream consumer could write the
// inferred vibe straight into the player's permanent profile), no
// server-validation hook for any reputation effect, no audit
// surface for bias / misclassification testing, and no impact
// clamp (the inferred vibe could drive world-authoritative state).
//
// This is the corrected build, single-thread / single-owner like every
// shipped Trinity component. The actual signal sources (input
// patterns, chat sentiment, microphone heuristics) are the deferred
// integration layer; this kernel is the SAFE storage / smoothing /
// gating / audit primitive that drives them.
//
// FIXED-POINT VALUES. vibeValue and vibeConfidence are Q16.16 in
// [0, FP_ONE]. FP_ONE represents 1.0. integer math everywhere - a
// run replays bit-for-bit regardless of FPU mode.
//
// EMA SMOOTHING (gate 3). injectSignal(vibeId, intensity) writes
// into the BACK accumulator: backValue = (backValue * smoothing +
// intensity * (FP_ONE - smoothing)) / FP_ONE. smoothing in [0,
// FP_ONE]; higher = more weight on history (heavier smoothing).
//
// CONFIDENCE (gate 3). vibeConfidence accumulates per signal up to
// FP_ONE; tick() decays it by confidenceDecayPerTick. The
// EFFECTIVE vibe seen by the consumer is value scaled by confidence
// - low confidence = damped output. A single noisy signal at low
// confidence does not drive any visible effect.
//
// HYSTERESIS (gate 3). Per-vibe activeFlag: ON when value crosses
// activationThreshold from below; OFF only when value drops below
// deactivationThreshold (deact < activ). The band between them is
// the hysteresis dead zone - prevents a borderline signal from
// flickering the UI.
//
// DOUBLE BUFFER (gate 4). frontVibeValue / backVibeValue, swapped
// on tick(). Producer writes back; consumer reads front. The
// consumer always reads the previous tick's smoothed value, never
// races the producer.
//
// CONSENT KILL SWITCH (gate 1). setPlayerConsent(false) silently
// drops every injectSignal AND zeroes every BACK value, BACK
// confidence, and active flag at the next tick(). isPlayer-
// ConsentEnabled() is the UI state. Default = false: the consumer
// must explicitly opt in.
//
// REPUTATION ISOLATION (gates 2, 5). The kernel exposes only
// getEffectiveVibe (damped read) and getActiveFlag (hysteresis-
// stabilised binary). It does NOT expose any "writeReputation" or
// "applyToPermanentState" surface - the reputation lives in a
// SEPARATE component the consumer wires in (LoomVerify is a typical
// seam: a reputation update is a HIGH-value action submitted as a
// claim that requires gameplay corroboration before applying). The
// gate is enforced by absence: reading this code, there is no path
// from inferred vibe to a permanent record.
//
// CORROBORATION (gate 2 - "must be corroborated by gameplay"). The
// consumer optionally calls corroborateWithGameplay(vibeId,
// gameplayScore) to inject confirming gameplay evidence (e.g. "the
// player chose 3 helpful actions"); getCorroboratedVibe(vibeId,
// minCorroboration) returns the effective vibe ONLY if the
// corroboration score is at least minCorroboration. Without
// corroboration, the consumer's permanent-reputation pipeline reads
// 0.
//
// ATMOSPHERE IMPACT CLAMP (gate 7). clampAtmosphereImpact(value)
// caps the effective vibe at maxAtmosphereImpact - a configured
// ceiling so the consumer's atmosphere driver (lighting tint,
// audio mix, NPC tone) cannot exceed a "subtle, local" effect.
// Documents the intended use envelope.
//
// AUDIT RING (gate 6). Per-vibe ring of the last auditRingSize raw
// signals (timestamp + intensity). The team can drain this ring
// for offline bias / misclassification analysis - the structural
// half of "add bias / misclassification tests."
//
// The 7 Codex gates for LoomPulse, enforced:
//   1. "explicit player consent and disable path" -
//      setPlayerConsent / isPlayerConsentEnabled; injectSignal is a
//      no-op when consent is false; back state is zeroed at the
//      next tick(); default is FALSE (consumer must opt in).
//   2. "keep inferred emotion out of permanent reputation unless
//      corroborated by gameplay actions" - no reputation API; the
//      kernel only exposes getEffectiveVibe / getActiveFlag /
//      getCorroboratedVibe; the corroboration-required output
//      returns 0 below threshold.
//   3. "per-vibe accumulators with decay, hysteresis, confidence" -
//      EMA with smoothing factor; per-vibe vibeConfidence with
//      confidenceDecayPerTick; activeFlag with activation /
//      deactivation thresholds (hysteresis band).
//   4. "double-buffer PlayerVibeComponent" - frontVibeValue +
//      backVibeValue, swapped by tick(); same for confidence and
//      active flag.
//   5. "server-validate reputation changes" - no reputation surface
//      here; the consumer routes reputation updates through a
//      separate verifier (LoomVerify is the established seam).
//   6. "bias / misclassification tests and accessibility review" -
//      auditRing exposes the last N raw signals for offline
//      analysis; per-vibe sample count + getRawSample API.
//   7. "atmosphere effects local / subtle, not world-authoritative" -
//      clampAtmosphereImpact caps the effective output at a
//      configured ceiling; documented as intended for local effects
//      (audio, lighting, NPC tone) only.
//
// Non-negotiable engine gates: no RNG; no wall clock - currentTick
// is an injected parameter, so a run replays bit-for-bit; single-
// thread, no Atomics; every vibeId / intensity / threshold bounds-
// checked; fixed-capacity storage. Storage allocated once in the
// constructor.
// Q16.16 fixed-point. PULSE_FP_ONE represents 1.0. Values + confidences
// + thresholds are Int32 in [0, PULSE_FP_ONE].
export const PULSE_FP_SHIFT = 16;
export const PULSE_FP_ONE = 1 << PULSE_FP_SHIFT; // 65536
// Sentinels.
export const VIBE_INVALID = -1;
// Per-vibe audit-ring record stride. drainAuditSample writes:
// [tickEmitted, intensity]. Two i32 per record.
export const AUDIT_RECORD_STRIDE = 2;
// Sanity caps on config-derived sizes - guards so a bad argument
// throws a clear error instead of attempting an absurd typed-array
// allocation.
const MAX_VIBES = 1 << 12;
const MAX_AUDIT_RING = 1 << 10;
const MAX_DECAY = PULSE_FP_ONE;
const MAX_SMOOTHING = PULSE_FP_ONE;
const MAX_THRESHOLD = PULSE_FP_ONE;
const MAX_CONFIDENCE_GAIN = PULSE_FP_ONE;
const U32_MAX = 0xffffffff;
export class LoomPulse {
    maxVibes;
    smoothing;
    valueDecayPerTick;
    confidenceDecayPerTick;
    confidenceGainPerSignal;
    activationThreshold;
    deactivationThreshold;
    maxAtmosphereImpact;
    auditRingSize;
    // Front buffer - what consumers read.
    frontVibeValue;
    frontVibeConfidence;
    frontActiveFlag;
    // Back buffer - producers write here; tick() promotes to front.
    backVibeValue;
    backVibeConfidence;
    backActiveFlag;
    // Per-vibe gameplay-corroboration score. corroborateWithGameplay
    // accumulates here; getCorroboratedVibe reads it. Decayed per tick
    // by valueDecayPerTick (corroboration is also stale-able).
    corroborationScore;
    // Per-vibe sample count - the number of raw signals received
    // since clear(). For bias-test accounting.
    sampleCount;
    // Per-vibe audit ring (gate 6). Records: [tickEmitted, intensity].
    // Per-vibe head index (mod auditRingSize); count tracks fill.
    auditRing;
    auditHead;
    auditCount;
    // Currently published tick. tick() advances + decays + swaps.
    currentTick = 0;
    // Consent gate (gate 1). Default FALSE - the consumer must
    // explicitly opt in.
    playerConsent = false;
    // Set on consent toggle to clear back state at next tick.
    pendingConsentClear = false;
    constructor(config) {
        const { maxVibes, smoothing, valueDecayPerTick, confidenceDecayPerTick, confidenceGainPerSignal, activationThreshold, deactivationThreshold, maxAtmosphereImpact, auditRingSize, } = config;
        if (!Number.isInteger(maxVibes) || maxVibes < 1 || maxVibes > MAX_VIBES) {
            throw new RangeError('LoomPulse: maxVibes must be in [1, ' + MAX_VIBES + '], got ' + maxVibes);
        }
        if (!Number.isInteger(smoothing) || smoothing < 0 || smoothing > MAX_SMOOTHING) {
            throw new RangeError('LoomPulse: smoothing must be in [0, ' + MAX_SMOOTHING + '], got ' + smoothing);
        }
        if (!Number.isInteger(valueDecayPerTick) || valueDecayPerTick < 0 || valueDecayPerTick > MAX_DECAY) {
            throw new RangeError('LoomPulse: valueDecayPerTick out of range, got ' + valueDecayPerTick);
        }
        if (!Number.isInteger(confidenceDecayPerTick) || confidenceDecayPerTick < 0
            || confidenceDecayPerTick > MAX_DECAY) {
            throw new RangeError('LoomPulse: confidenceDecayPerTick out of range, got ' + confidenceDecayPerTick);
        }
        if (!Number.isInteger(confidenceGainPerSignal) || confidenceGainPerSignal < 0
            || confidenceGainPerSignal > MAX_CONFIDENCE_GAIN) {
            throw new RangeError('LoomPulse: confidenceGainPerSignal out of range, got ' + confidenceGainPerSignal);
        }
        if (!Number.isInteger(activationThreshold) || activationThreshold < 0
            || activationThreshold > MAX_THRESHOLD) {
            throw new RangeError('LoomPulse: activationThreshold out of range, got ' + activationThreshold);
        }
        if (!Number.isInteger(deactivationThreshold) || deactivationThreshold < 0
            || deactivationThreshold > MAX_THRESHOLD) {
            throw new RangeError('LoomPulse: deactivationThreshold out of range, got ' + deactivationThreshold);
        }
        if (deactivationThreshold >= activationThreshold) {
            throw new RangeError('LoomPulse: deactivationThreshold (' + deactivationThreshold
                + ') must be < activationThreshold (' + activationThreshold + ') for a hysteresis band');
        }
        if (!Number.isInteger(maxAtmosphereImpact) || maxAtmosphereImpact < 0
            || maxAtmosphereImpact > PULSE_FP_ONE) {
            throw new RangeError('LoomPulse: maxAtmosphereImpact out of range, got ' + maxAtmosphereImpact);
        }
        if (!Number.isInteger(auditRingSize) || auditRingSize < 1 || auditRingSize > MAX_AUDIT_RING) {
            throw new RangeError('LoomPulse: auditRingSize out of range, got ' + auditRingSize);
        }
        this.maxVibes = maxVibes;
        this.smoothing = smoothing;
        this.valueDecayPerTick = valueDecayPerTick;
        this.confidenceDecayPerTick = confidenceDecayPerTick;
        this.confidenceGainPerSignal = confidenceGainPerSignal;
        this.activationThreshold = activationThreshold;
        this.deactivationThreshold = deactivationThreshold;
        this.maxAtmosphereImpact = maxAtmosphereImpact;
        this.auditRingSize = auditRingSize;
        this.frontVibeValue = new Int32Array(maxVibes);
        this.frontVibeConfidence = new Int32Array(maxVibes);
        this.frontActiveFlag = new Uint8Array(maxVibes);
        this.backVibeValue = new Int32Array(maxVibes);
        this.backVibeConfidence = new Int32Array(maxVibes);
        this.backActiveFlag = new Uint8Array(maxVibes);
        this.corroborationScore = new Int32Array(maxVibes);
        this.sampleCount = new Uint32Array(maxVibes);
        this.auditRing = new Int32Array(maxVibes * auditRingSize * AUDIT_RECORD_STRIDE);
        this.auditHead = new Uint32Array(maxVibes);
        this.auditCount = new Uint32Array(maxVibes);
    }
    // --- consent gate (gate 1) ---
    // Toggle player consent for vibe inference. When false, every
    // subsequent injectSignal is silently dropped, AND at the next
    // tick() the back vibe / confidence / active state is zeroed
    // (so the consumer's UI sees a clean state once the swap lands).
    // Default is FALSE - the consumer must explicitly opt in.
    setPlayerConsent(enabled) {
        const next = !!enabled;
        // Schedule a back-state wipe only on opt-OUT (true -> false). The
        // opt-out invalidates everything inferred under prior consent.
        // Opt-IN (false -> true) leaves the (already-zero) state alone.
        if (this.playerConsent && !next) {
            this.pendingConsentClear = true;
        }
        this.playerConsent = next;
    }
    isPlayerConsentEnabled() {
        return this.playerConsent;
    }
    // --- signal injection (gate 3) ---
    // Inject a vibe signal. intensity is fp in [0, PULSE_FP_ONE].
    // No-op (silent) if consent is denied. Returns false if input
    // out of range.
    injectSignal(vibeId, intensity) {
        if (!this.requireVibeId(vibeId))
            return false;
        if (!Number.isInteger(intensity) || intensity < 0 || intensity > PULSE_FP_ONE)
            return false;
        if (!this.playerConsent)
            return true; // silent drop with consent denied
        // EMA in fp: back = (back * smoothing + intensity * (FP_ONE - smoothing)) / FP_ONE.
        // Use plain * - both operands are <= PULSE_FP_ONE = 2^16, so the
        // product fits in 2^32 (well within JS double's 2^53 exact-integer
        // range). Math.imul would give signed-int32 overflow when the
        // product exceeds 2^31.
        const back = this.backVibeValue[vibeId] ?? 0;
        const histTerm = back * this.smoothing;
        const newTerm = intensity * (PULSE_FP_ONE - this.smoothing);
        const ema = Math.floor((histTerm + newTerm) / PULSE_FP_ONE);
        this.backVibeValue[vibeId] = Math.max(0, Math.min(PULSE_FP_ONE, ema));
        // Confidence gain (gate 3): cap at FP_ONE.
        const conf = (this.backVibeConfidence[vibeId] ?? 0) + this.confidenceGainPerSignal;
        this.backVibeConfidence[vibeId] = Math.min(PULSE_FP_ONE, conf);
        // Update hysteresis active flag (gate 3).
        const active = this.backActiveFlag[vibeId] ?? 0;
        const v = this.backVibeValue[vibeId] ?? 0;
        if (active === 0 && v > this.activationThreshold) {
            this.backActiveFlag[vibeId] = 1;
        }
        else if (active === 1 && v < this.deactivationThreshold) {
            this.backActiveFlag[vibeId] = 0;
        }
        // Audit ring (gate 6).
        this.sampleCount[vibeId] = ((this.sampleCount[vibeId] ?? 0) + 1) >>> 0;
        const ringHead = this.auditHead[vibeId] ?? 0;
        const ringSlot = (vibeId * this.auditRingSize + ringHead) * AUDIT_RECORD_STRIDE;
        this.auditRing[ringSlot + 0] = this.currentTick | 0;
        this.auditRing[ringSlot + 1] = intensity | 0;
        this.auditHead[vibeId] = (ringHead + 1) % this.auditRingSize;
        if ((this.auditCount[vibeId] ?? 0) < this.auditRingSize) {
            this.auditCount[vibeId] = ((this.auditCount[vibeId] ?? 0) + 1) >>> 0;
        }
        return true;
    }
    // --- corroboration (gate 2) ---
    // Inject a gameplay corroboration score for vibeId. The CONSUMER
    // is responsible for translating gameplay events (e.g. "the player
    // chose 3 helpful actions") into corroboration scores; the kernel
    // accumulates them up to PULSE_FP_ONE and decays per tick.
    corroborateWithGameplay(vibeId, score) {
        if (!this.requireVibeId(vibeId))
            return false;
        if (!Number.isInteger(score) || score < 0 || score > PULSE_FP_ONE)
            return false;
        if (!this.playerConsent)
            return true; // silent drop
        const cur = this.corroborationScore[vibeId] ?? 0;
        this.corroborationScore[vibeId] = Math.min(PULSE_FP_ONE, cur + score);
        return true;
    }
    // --- consumer reads ---
    // Effective vibe = front value scaled by front confidence.
    // Returns fp in [0, PULSE_FP_ONE]. The consumer's atmosphere
    // driver typically reads this and feeds clampAtmosphereImpact.
    getEffectiveVibe(vibeId) {
        if (!this.requireVibeId(vibeId))
            return 0;
        const v = this.frontVibeValue[vibeId] ?? 0;
        const c = this.frontVibeConfidence[vibeId] ?? 0;
        // (v * c) / PULSE_FP_ONE - plain * is exact for v, c <= 2^16.
        return Math.floor((v * c) / PULSE_FP_ONE);
    }
    // Hysteresis-stabilised binary - the recommended UI gate. Returns
    // true only when the vibe is in its ACTIVE state (above
    // activationThreshold and not yet dropped below deactivation).
    getActiveFlag(vibeId) {
        if (!this.requireVibeId(vibeId))
            return false;
        return (this.frontActiveFlag[vibeId] ?? 0) === 1;
    }
    // The reputation-gated read (gates 2, 5). Returns the effective
    // vibe ONLY if the corroboration score is at least minCorroboration.
    // Below the threshold returns 0. The consumer's permanent-
    // reputation pipeline reads THIS, never getEffectiveVibe directly.
    getCorroboratedVibe(vibeId, minCorroboration) {
        if (!this.requireVibeId(vibeId))
            return 0;
        if (!Number.isInteger(minCorroboration) || minCorroboration < 0
            || minCorroboration > PULSE_FP_ONE)
            return 0;
        const corrob = this.corroborationScore[vibeId] ?? 0;
        if (corrob < minCorroboration)
            return 0;
        return this.getEffectiveVibe(vibeId);
    }
    // Apply the gate-7 atmosphere clamp. The consumer's atmosphere
    // driver passes a value (typically from getEffectiveVibe) and the
    // kernel returns the clamped magnitude - capped at
    // maxAtmosphereImpact. Documents the intent: atmosphere is local
    // and subtle.
    clampAtmosphereImpact(value) {
        if (!Number.isInteger(value) || value < 0)
            return 0;
        return Math.min(this.maxAtmosphereImpact, value);
    }
    // --- audit surface (gate 6) ---
    // Number of samples seen for vibeId since clear(). Useful for the
    // bias-test accounting ("how confident are we in our reading?").
    getSampleCount(vibeId) {
        if (!this.requireVibeId(vibeId))
            return 0;
        return this.sampleCount[vibeId] ?? 0;
    }
    // Number of records currently in vibeId's audit ring (capped at
    // auditRingSize).
    getAuditRingCount(vibeId) {
        if (!this.requireVibeId(vibeId))
            return 0;
        return this.auditCount[vibeId] ?? 0;
    }
    // Read the i-th most recent audit sample for vibeId. i=0 is the
    // newest. Writes [tickEmitted, intensity] into out[outOffset..+2].
    // Returns false if i is out of range.
    readAuditSample(vibeId, i, out, outOffset = 0) {
        if (!this.requireVibeId(vibeId))
            return false;
        if (!Number.isInteger(i) || i < 0)
            return false;
        const count = this.auditCount[vibeId] ?? 0;
        if (i >= count)
            return false;
        if (outOffset < 0 || outOffset + AUDIT_RECORD_STRIDE > out.length)
            return false;
        // The most recent sample is at (head - 1) mod ringSize; i-th
        // newest is at (head - 1 - i) mod ringSize.
        const head = this.auditHead[vibeId] ?? 0;
        const slot = ((head - 1 - i) % this.auditRingSize + this.auditRingSize) % this.auditRingSize;
        const off = (vibeId * this.auditRingSize + slot) * AUDIT_RECORD_STRIDE;
        out[outOffset + 0] = this.auditRing[off + 0] ?? 0;
        out[outOffset + 1] = this.auditRing[off + 1] ?? 0;
        return true;
    }
    // --- tick (gates 3, 4) ---
    // Advance currentTick to t, decay back state, swap front <- back,
    // honour any pending consent-clear. Idempotent ONLY if t is the
    // same; calling tick(t+1) twice decays twice.
    tick(t) {
        if (!Number.isInteger(t) || t < 0 || t > U32_MAX) {
            throw new RangeError('LoomPulse.tick: t must be a u32, got ' + t);
        }
        this.currentTick = t | 0;
        // Pending consent-clear (gate 1): the toggle scheduled a back-zero
        // so the consumer's next tick reads 0 across the board.
        if (this.pendingConsentClear) {
            this.backVibeValue.fill(0);
            this.backVibeConfidence.fill(0);
            this.backActiveFlag.fill(0);
            this.corroborationScore.fill(0);
            this.pendingConsentClear = false;
        }
        else if (this.playerConsent) {
            // Apply per-tick decays (gate 3) - only when consent is on.
            // Otherwise decays are pointless (back is zero anyway).
            const valDec = this.valueDecayPerTick;
            const conDec = this.confidenceDecayPerTick;
            for (let i = 0; i < this.maxVibes; i++) {
                if (valDec > 0) {
                    const v = this.backVibeValue[i] ?? 0;
                    this.backVibeValue[i] = Math.floor((v * (PULSE_FP_ONE - valDec)) / PULSE_FP_ONE);
                }
                if (conDec > 0) {
                    const c = this.backVibeConfidence[i] ?? 0;
                    this.backVibeConfidence[i] = Math.floor((c * (PULSE_FP_ONE - conDec)) / PULSE_FP_ONE);
                }
                // Re-evaluate hysteresis after decay.
                const active = this.backActiveFlag[i] ?? 0;
                const v = this.backVibeValue[i] ?? 0;
                if (active === 1 && v < this.deactivationThreshold) {
                    this.backActiveFlag[i] = 0;
                }
                // Decay corroboration score - gameplay evidence ages.
                if (valDec > 0) {
                    const cs = this.corroborationScore[i] ?? 0;
                    this.corroborationScore[i] = Math.floor((cs * (PULSE_FP_ONE - valDec)) / PULSE_FP_ONE);
                }
            }
        }
        // Swap front <- back (gate 4).
        for (let i = 0; i < this.maxVibes; i++) {
            this.frontVibeValue[i] = this.backVibeValue[i] ?? 0;
            this.frontVibeConfidence[i] = this.backVibeConfidence[i] ?? 0;
            this.frontActiveFlag[i] = this.backActiveFlag[i] ?? 0;
        }
    }
    // --- helpers ---
    requireVibeId(id) {
        return Number.isInteger(id) && id >= 0 && id < this.maxVibes;
    }
    getCurrentTick() { return this.currentTick; }
    // --- lifecycle ---
    // Reset every vibe / confidence / corroboration / audit ring;
    // leaves backing arrays allocated. After clear() the kernel is in
    // its constructor state; consent stays as last-set.
    clear() {
        this.frontVibeValue.fill(0);
        this.frontVibeConfidence.fill(0);
        this.frontActiveFlag.fill(0);
        this.backVibeValue.fill(0);
        this.backVibeConfidence.fill(0);
        this.backActiveFlag.fill(0);
        this.corroborationScore.fill(0);
        this.sampleCount.fill(0);
        this.auditRing.fill(0);
        this.auditHead.fill(0);
        this.auditCount.fill(0);
        this.pendingConsentClear = false;
    }
}
//# sourceMappingURL=loom-pulse.js.map