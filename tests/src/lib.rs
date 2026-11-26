//! Cross-contract integration tests for SoroRail.
//!
//! This crate carries no library code. The tests live in `tests/`, where each
//! file is a separate integration binary that links the contract crates the
//! way an external consumer would, rather than reaching into their internals.
//!
//! Per-contract behaviour is covered by unit tests inside each contract crate.
//! What is tested here is what those cannot see: several contracts sharing one
//! token, and whether value is conserved across the system as a whole rather
//! than within one contract at a time.
