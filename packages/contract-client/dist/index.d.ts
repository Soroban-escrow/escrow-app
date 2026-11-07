import { Buffer } from "buffer";
import { AssembledTransaction, Client as ContractClient, ClientOptions as ContractClientOptions, MethodOptions, Result } from "@stellar/stellar-sdk/contract";
import type { u32, u64, i128, Option } from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";
export interface Bounty {
    amount: i128;
    created_at: u64;
    deadline: u64;
    fee_bps: u32;
    id: u64;
    issue: u64;
    maintainer: string;
    relayer_allowed: boolean;
    repo_id: u64;
    status: Status;
    token: string;
    winner: Option<string>;
}
export interface Config {
    admin: string;
    arbiter: string;
    fee_bps: u32;
    grace_secs: u64;
    max_duration_secs: u64;
    min_duration_secs: u64;
    paused: boolean;
    relayer: string;
    treasury: string;
}
export type Status = {
    tag: "Open";
    values: void;
} | {
    tag: "Released";
    values: void;
} | {
    tag: "Refunded";
    values: void;
} | {
    tag: "Disputed";
    values: void;
} | {
    tag: "Resolved";
    values: void;
};
/**
 * Per-token accounting: funded == released_net + fees + refunded + held.
 */
export interface Totals {
    fees: i128;
    funded: i128;
    held: i128;
    refunded: i128;
    released_net: i128;
}
export interface TokenLimits {
    max_amount: i128;
    min_amount: i128;
}
/**
 * Stable numbering: never renumber after deploy.
 */
export declare const Errors: {
    1: {
        message: string;
    };
    2: {
        message: string;
    };
    3: {
        message: string;
    };
    4: {
        message: string;
    };
    5: {
        message: string;
    };
    6: {
        message: string;
    };
    7: {
        message: string;
    };
    8: {
        message: string;
    };
    9: {
        message: string;
    };
    10: {
        message: string;
    };
    11: {
        message: string;
    };
    12: {
        message: string;
    };
    13: {
        message: string;
    };
    14: {
        message: string;
    };
    15: {
        message: string;
    };
    16: {
        message: string;
    };
    17: {
        message: string;
    };
};
export type ContractErrorNumber = keyof typeof Errors;
export type ContractErrorName = (typeof Errors)[ContractErrorNumber]["message"];
/**
 * Mapping of contract error message names to their stable error numbers.
 * Derived directly from generated contract Errors specification.
 */
export declare const CONTRACT_ERROR_NUMBERS: Record<ContractErrorName, number>;
/**
 * Mapping of contract error numbers to their message names.
 * Derived directly from generated contract Errors specification.
 */
export declare const CONTRACT_ERROR_NAMES: Record<number, ContractErrorName>;
/**
 * Convenient enum object mapping Error Name to Number.
 */
export declare const ContractErrorEnum: Record<ContractErrorName, number>;
export interface Client {
    /**
     * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    init: ({ admin, relayer, arbiter, treasury, fee_bps, grace_secs, min_duration_secs, max_duration_secs }: {
        admin: string;
        relayer: string;
        arbiter: string;
        treasury: string;
        fee_bps: u32;
        grace_secs: u64;
        min_duration_secs: u64;
        max_duration_secs: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Blocks `fund_bounty` only; release, refund and resolve keep working.
     */
    pause: ({ admin }: {
        admin: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    refund: ({ maintainer, bounty_id }: {
        maintainer: string;
        bounty_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a release transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    release: ({ caller, bounty_id, winner }: {
        caller: string;
        bounty_id: u64;
        winner: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a resolve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    resolve: ({ arbiter, bounty_id, winner, winner_bps }: {
        arbiter: string;
        bounty_id: u64;
        winner: Option<string>;
        winner_bps: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a set_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_fee: ({ admin, fee_bps }: {
        admin: string;
        fee_bps: u32;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    unpause: ({ admin }: {
        admin: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    upgrade: ({ admin, wasm_hash }: {
        admin: string;
        wasm_hash: Buffer;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a get_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_token: ({ token }: {
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Option<TokenLimits>>>;
    /**
     * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     * Two-party auth: the new admin must also sign, to avoid typos.
     */
    set_admin: ({ admin, new_admin }: {
        admin: string;
        new_admin: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a set_grace transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_grace: ({ admin, grace_secs }: {
        admin: string;
        grace_secs: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a set_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_token: ({ admin, token, min, max }: {
        admin: string;
        token: string;
        min: i128;
        max: i128;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a get_bounty transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_bounty: ({ id }: {
        id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<Bounty>>>;
    /**
     * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>;
    /**
     * Construct and simulate a get_totals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    get_totals: ({ token }: {
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Totals>>;
    /**
     * Construct and simulate a fund_bounty transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    fund_bounty: ({ maintainer, repo_id, issue, token, amount, deadline, relayer_allowed }: {
        maintainer: string;
        repo_id: u64;
        issue: u64;
        token: string;
        amount: i128;
        deadline: u64;
        relayer_allowed: boolean;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>;
    /**
     * Construct and simulate a set_arbiter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_arbiter: ({ admin, arbiter }: {
        admin: string;
        arbiter: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a set_relayer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_relayer: ({ admin, relayer }: {
        admin: string;
        relayer: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a open_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    open_dispute: ({ caller, bounty_id }: {
        caller: string;
        bounty_id: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a remove_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    remove_token: ({ admin, token }: {
        admin: string;
        token: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a set_treasury transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_treasury: ({ admin, treasury }: {
        admin: string;
        treasury: string;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
    /**
     * Construct and simulate a active_bounty transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    active_bounty: ({ repo_id, issue }: {
        repo_id: u64;
        issue: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Option<u64>>>;
    /**
     * Construct and simulate a set_durations transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
     */
    set_durations: ({ admin, min, max }: {
        admin: string;
        min: u64;
        max: u64;
    }, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>;
}
export declare class Client extends ContractClient {
    readonly options: ContractClientOptions;
    static deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions & Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
    }): Promise<AssembledTransaction<T>>;
    constructor(options: ContractClientOptions);
    readonly fromJSON: {
        init: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        pause: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        refund: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        release: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        resolve: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        set_fee: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        unpause: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        upgrade: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_token: (json: string) => AssembledTransaction<Option<TokenLimits>>;
        set_admin: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        set_grace: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        set_token: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_bounty: (json: string) => AssembledTransaction<Result<Bounty, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_config: (json: string) => AssembledTransaction<Result<Config, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        get_totals: (json: string) => AssembledTransaction<Totals>;
        fund_bounty: (json: string) => AssembledTransaction<Result<bigint, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        set_arbiter: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        set_relayer: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        open_dispute: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        remove_token: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        set_treasury: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
        active_bounty: (json: string) => AssembledTransaction<Option<bigint>>;
        set_durations: (json: string) => AssembledTransaction<Result<void, import("@stellar/stellar-sdk/contract").ErrorMessage>>;
    };
}
