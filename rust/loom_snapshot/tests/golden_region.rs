//! Cross-language parity: the Rust region hashing must reproduce the TS-generated
//! golden vector (test_vectors/v5_3_region_hash.json) byte-for-byte - the per-region
//! leaf hashes AND the global Merkle root, plus the Merkle property (mutating one
//! region changes only its leaf + the root).

use loom_snapshot::{global_region_hash, region_leaves};
use serde_json::Value;
use std::fs;

#[test]
fn golden_region_byte_parity_with_ts() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../test_vectors/v5_3_region_hash.json");
    let v: Value = serde_json::from_str(&fs::read_to_string(path).expect("read")).expect("parse");
    let i = &v["inputs"];
    let key = i["key"].as_str().unwrap().as_bytes();

    let leaves = region_leaves(key, &i["regions"]).unwrap();
    assert_eq!(leaves, v["expect"]["leaves_before"], "leaves before");
    assert_eq!(global_region_hash(key, &i["regions"]).unwrap(), v["expect"]["global_before"].as_str().unwrap(), "global before");

    let leaves2 = region_leaves(key, &i["regions_after_south_mutation"]).unwrap();
    assert_eq!(leaves2, v["expect"]["leaves_after"], "leaves after");
    assert_eq!(global_region_hash(key, &i["regions_after_south_mutation"]).unwrap(), v["expect"]["global_after"].as_str().unwrap(), "global after");

    // Merkle property: only the mutated region's leaf (+ the root) changes.
    assert_eq!(leaves["north"], leaves2["north"], "north leaf unchanged");
    assert_eq!(leaves["east"], leaves2["east"], "east leaf unchanged");
    assert_ne!(leaves["south"], leaves2["south"], "south leaf changed");
}
