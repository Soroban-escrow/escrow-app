//! Recurring events.
//!
//! Follows the org convention in `sororail_common::events`.

use soroban_sdk::{contractevent, Address};

/// A payer authorized a recurring pull.
#[contractevent(topics = ["recurring", "authorized"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Authorized {
    #[topic]
    pub payer: Address,
    pub payee: Address,
    pub token: Address,
    pub amount_per_period: i128,
    pub period_seconds: u64,
    pub max_periods: Option<u32>,
    pub first_chargeable_at: u64,
}

/// The payee pulled one period's payment.
#[contractevent(topics = ["recurring", "charged"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Charged {
    #[topic]
    pub payee: Address,
    pub payer: Address,
    pub amount: i128,
    /// How many charges have now been taken.
    pub periods_charged: u32,
    /// When the next charge becomes available.
    pub next_chargeable_at: u64,
}

/// Either party cancelled the authorization.
#[contractevent(topics = ["recurring", "cancelled"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Cancelled {
    #[topic]
    pub cancelled_by: Address,
    pub periods_charged: u32,
    pub cancelled_at: u64,
}
