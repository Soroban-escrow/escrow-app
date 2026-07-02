import { Buffer } from "buffer";
import { Address } from "@stellar/stellar-sdk";
import {
  AssembledTransaction,
  Client as ContractClient,
  ClientOptions as ContractClientOptions,
  MethodOptions,
  Result,
  Spec as ContractSpec,
} from "@stellar/stellar-sdk/contract";
import type {
  u32,
  i32,
  u64,
  i64,
  u128,
  i128,
  u256,
  i256,
  Option,
  Timepoint,
  Duration,
} from "@stellar/stellar-sdk/contract";
export * from "@stellar/stellar-sdk";
export * as contract from "@stellar/stellar-sdk/contract";
export * as rpc from "@stellar/stellar-sdk/rpc";

if (typeof window !== "undefined") {
  //@ts-ignore Buffer exists
  window.Buffer = window.Buffer || Buffer;
}





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

export type Status = {tag: "Open", values: void} | {tag: "Released", values: void} | {tag: "Refunded", values: void} | {tag: "Disputed", values: void} | {tag: "Resolved", values: void};


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
export const Errors = {
  1: {message:"AlreadyInitialized"},
  2: {message:"NotInitialized"},
  3: {message:"Unauthorized"},
  4: {message:"Paused"},
  5: {message:"TokenNotAllowed"},
  6: {message:"AmountTooSmall"},
  7: {message:"AmountTooLarge"},
  8: {message:"InvalidDeadline"},
  9: {message:"IssueAlreadyFunded"},
  10: {message:"BountyNotFound"},
  11: {message:"InvalidStatus"},
  12: {message:"DeadlineNotReached"},
  13: {message:"SelfPayout"},
  14: {message:"InvalidSplit"},
  15: {message:"InvalidFee"},
  16: {message:"Overflow"},
  17: {message:"RelayerNotAllowed"}
}










export interface Client {
  /**
   * Construct and simulate a init transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  init: ({admin, relayer, arbiter, treasury, fee_bps, grace_secs, min_duration_secs, max_duration_secs}: {admin: string, relayer: string, arbiter: string, treasury: string, fee_bps: u32, grace_secs: u64, min_duration_secs: u64, max_duration_secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a pause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Blocks `fund_bounty` only; release, refund and resolve keep working.
   */
  pause: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a refund transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  refund: ({maintainer, bounty_id}: {maintainer: string, bounty_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a release transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  release: ({caller, bounty_id, winner}: {caller: string, bounty_id: u64, winner: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a resolve transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  resolve: ({arbiter, bounty_id, winner, winner_bps}: {arbiter: string, bounty_id: u64, winner: Option<string>, winner_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_fee transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_fee: ({admin, fee_bps}: {admin: string, fee_bps: u32}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a unpause transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  unpause: ({admin}: {admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a upgrade transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  upgrade: ({admin, wasm_hash}: {admin: string, wasm_hash: Buffer}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_token: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Option<TokenLimits>>>

  /**
   * Construct and simulate a set_admin transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   * Two-party auth: the new admin must also sign, to avoid typos.
   */
  set_admin: ({admin, new_admin}: {admin: string, new_admin: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_grace transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_grace: ({admin, grace_secs}: {admin: string, grace_secs: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_token: ({admin, token, min, max}: {admin: string, token: string, min: i128, max: i128}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a get_bounty transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_bounty: ({id}: {id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<Bounty>>>

  /**
   * Construct and simulate a get_config transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_config: (options?: MethodOptions) => Promise<AssembledTransaction<Result<Config>>>

  /**
   * Construct and simulate a get_totals transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  get_totals: ({token}: {token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Totals>>

  /**
   * Construct and simulate a fund_bounty transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  fund_bounty: ({maintainer, repo_id, issue, token, amount, deadline, relayer_allowed}: {maintainer: string, repo_id: u64, issue: u64, token: string, amount: i128, deadline: u64, relayer_allowed: boolean}, options?: MethodOptions) => Promise<AssembledTransaction<Result<u64>>>

  /**
   * Construct and simulate a set_arbiter transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_arbiter: ({admin, arbiter}: {admin: string, arbiter: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_relayer transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_relayer: ({admin, relayer}: {admin: string, relayer: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a open_dispute transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  open_dispute: ({caller, bounty_id}: {caller: string, bounty_id: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a remove_token transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  remove_token: ({admin, token}: {admin: string, token: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a set_treasury transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_treasury: ({admin, treasury}: {admin: string, treasury: string}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

  /**
   * Construct and simulate a active_bounty transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  active_bounty: ({repo_id, issue}: {repo_id: u64, issue: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Option<u64>>>

  /**
   * Construct and simulate a set_durations transaction. Returns an `AssembledTransaction` object which will have a `result` field containing the result of the simulation. If this transaction changes contract state, you will need to call `signAndSend()` on the returned object.
   */
  set_durations: ({admin, min, max}: {admin: string, min: u64, max: u64}, options?: MethodOptions) => Promise<AssembledTransaction<Result<void>>>

}
export class Client extends ContractClient {
  static async deploy<T = Client>(
    /** Options for initializing a Client as well as for calling a method, with extras specific to deploying. */
    options: MethodOptions &
      Omit<ContractClientOptions, "contractId"> & {
        /** The hash of the Wasm blob, which must already be installed on-chain. */
        wasmHash: Buffer | string;
        /** Salt used to generate the contract's ID. Passed through to {@link Operation.createCustomContract}. Default: random. */
        salt?: Buffer | Uint8Array;
        /** The format used to decode `wasmHash`, if it's provided as a string. */
        format?: "hex" | "base64";
      }
  ): Promise<AssembledTransaction<T>> {
    return ContractClient.deploy(null, options)
  }
  constructor(public readonly options: ContractClientOptions) {
    super(
      new ContractSpec([ "AAAAAAAAAAAAAAAEaW5pdAAAAAgAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAHcmVsYXllcgAAAAATAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAACHRyZWFzdXJ5AAAAEwAAAAAAAAAHZmVlX2JwcwAAAAAEAAAAAAAAAApncmFjZV9zZWNzAAAAAAAGAAAAAAAAABFtaW5fZHVyYXRpb25fc2VjcwAAAAAAAAYAAAAAAAAAEW1heF9kdXJhdGlvbl9zZWNzAAAAAAAABgAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAERCbG9ja3MgYGZ1bmRfYm91bnR5YCBvbmx5OyByZWxlYXNlLCByZWZ1bmQgYW5kIHJlc29sdmUga2VlcCB3b3JraW5nLgAAAAVwYXVzZQAAAAAAAAEAAAAAAAAABWFkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAGcmVmdW5kAAAAAAACAAAAAAAAAAptYWludGFpbmVyAAAAAAATAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAHcmVsZWFzZQAAAAADAAAAAAAAAAZjYWxsZXIAAAAAABMAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAABndpbm5lcgAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAHcmVzb2x2ZQAAAAAEAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAACWJvdW50eV9pZAAAAAAAAAYAAAAAAAAABndpbm5lcgAAAAAD6AAAABMAAAAAAAAACndpbm5lcl9icHMAAAAAAAQAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAHc2V0X2ZlZQAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAHdW5wYXVzZQAAAAABAAAAAAAAAAVhZG1pbgAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAHdXBncmFkZQAAAAACAAAAAAAAAAVhZG1pbgAAAAAAABMAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAJZ2V0X3Rva2VuAAAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAA+gAAAfQAAAAC1Rva2VuTGltaXRzAA==",
        "AAAAAAAAAD1Ud28tcGFydHkgYXV0aDogdGhlIG5ldyBhZG1pbiBtdXN0IGFsc28gc2lnbiwgdG8gYXZvaWQgdHlwb3MuAAAAAAAACXNldF9hZG1pbgAAAAAAAAIAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAAJbmV3X2FkbWluAAAAAAAAEwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAJc2V0X2dyYWNlAAAAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAApncmFjZV9zZWNzAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAJc2V0X3Rva2VuAAAAAAAABAAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAAA21pbgAAAAALAAAAAAAAAANtYXgAAAAACwAAAAEAAAPpAAAAAgAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X2JvdW50eQAAAAAAAQAAAAAAAAACaWQAAAAAAAYAAAABAAAD6QAAB9AAAAAGQm91bnR5AAAAAAAD",
        "AAAAAAAAAAAAAAAKZ2V0X2NvbmZpZwAAAAAAAAAAAAEAAAPpAAAH0AAAAAZDb25maWcAAAAAAAM=",
        "AAAAAAAAAAAAAAAKZ2V0X3RvdGFscwAAAAAAAQAAAAAAAAAFdG9rZW4AAAAAAAATAAAAAQAAB9AAAAAGVG90YWxzAAA=",
        "AAAAAAAAAAAAAAALZnVuZF9ib3VudHkAAAAABwAAAAAAAAAKbWFpbnRhaW5lcgAAAAAAEwAAAAAAAAAHcmVwb19pZAAAAAAGAAAAAAAAAAVpc3N1ZQAAAAAAAAYAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAAD3JlbGF5ZXJfYWxsb3dlZAAAAAABAAAAAQAAA+kAAAAGAAAAAw==",
        "AAAAAAAAAAAAAAALc2V0X2FyYml0ZXIAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdhcmJpdGVyAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAALc2V0X3JlbGF5ZXIAAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdyZWxheWVyAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAMb3Blbl9kaXNwdXRlAAAAAgAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAlib3VudHlfaWQAAAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAAAAAAAAAAAMcmVtb3ZlX3Rva2VuAAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAV0b2tlbgAAAAAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAAMc2V0X3RyZWFzdXJ5AAAAAgAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAh0cmVhc3VyeQAAABMAAAABAAAD6QAAAAIAAAAD",
        "AAAAAAAAAAAAAAANYWN0aXZlX2JvdW50eQAAAAAAAAIAAAAAAAAAB3JlcG9faWQAAAAABgAAAAAAAAAFaXNzdWUAAAAAAAAGAAAAAQAAA+gAAAAG",
        "AAAAAAAAAAAAAAANc2V0X2R1cmF0aW9ucwAAAAAAAAMAAAAAAAAABWFkbWluAAAAAAAAEwAAAAAAAAADbWluAAAAAAYAAAAAAAAAA21heAAAAAAGAAAAAQAAA+kAAAACAAAAAw==",
        "AAAAAQAAAAAAAAAAAAAABkJvdW50eQAAAAAADAAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAApjcmVhdGVkX2F0AAAAAAAGAAAAAAAAAAhkZWFkbGluZQAAAAYAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAACaWQAAAAAAAYAAAAAAAAABWlzc3VlAAAAAAAABgAAAAAAAAAKbWFpbnRhaW5lcgAAAAAAEwAAAAAAAAAPcmVsYXllcl9hbGxvd2VkAAAAAAEAAAAAAAAAB3JlcG9faWQAAAAABgAAAAAAAAAGc3RhdHVzAAAAAAfQAAAABlN0YXR1cwAAAAAAAAAAAAV0b2tlbgAAAAAAABMAAAAAAAAABndpbm5lcgAAAAAD6AAAABM=",
        "AAAAAQAAAAAAAAAAAAAABkNvbmZpZwAAAAAACQAAAAAAAAAFYWRtaW4AAAAAAAATAAAAAAAAAAdhcmJpdGVyAAAAABMAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAAKZ3JhY2Vfc2VjcwAAAAAABgAAAAAAAAARbWF4X2R1cmF0aW9uX3NlY3MAAAAAAAAGAAAAAAAAABFtaW5fZHVyYXRpb25fc2VjcwAAAAAAAAYAAAAAAAAABnBhdXNlZAAAAAAAAQAAAAAAAAAHcmVsYXllcgAAAAATAAAAAAAAAAh0cmVhc3VyeQAAABM=",
        "AAAAAgAAAAAAAAAAAAAABlN0YXR1cwAAAAAABQAAAAAAAAAAAAAABE9wZW4AAAAAAAAAAAAAAAhSZWxlYXNlZAAAAAAAAAAAAAAACFJlZnVuZGVkAAAAAAAAAAAAAAAIRGlzcHV0ZWQAAAAAAAAAAAAAAAhSZXNvbHZlZA==",
        "AAAAAQAAAEZQZXItdG9rZW4gYWNjb3VudGluZzogZnVuZGVkID09IHJlbGVhc2VkX25ldCArIGZlZXMgKyByZWZ1bmRlZCArIGhlbGQuAAAAAAAAAAAABlRvdGFscwAAAAAABQAAAAAAAAAEZmVlcwAAAAsAAAAAAAAABmZ1bmRlZAAAAAAACwAAAAAAAAAEaGVsZAAAAAsAAAAAAAAACHJlZnVuZGVkAAAACwAAAAAAAAAMcmVsZWFzZWRfbmV0AAAACw==",
        "AAAAAQAAAAAAAAAAAAAAC1Rva2VuTGltaXRzAAAAAAIAAAAAAAAACm1heF9hbW91bnQAAAAAAAsAAAAAAAAACm1pbl9hbW91bnQAAAAAAAs=",
        "AAAABAAAAC5TdGFibGUgbnVtYmVyaW5nOiBuZXZlciByZW51bWJlciBhZnRlciBkZXBsb3kuAAAAAAAAAAAABUVycm9yAAAAAAAAEQAAAAAAAAASQWxyZWFkeUluaXRpYWxpemVkAAAAAAABAAAAAAAAAA5Ob3RJbml0aWFsaXplZAAAAAAAAgAAAAAAAAAMVW5hdXRob3JpemVkAAAAAwAAAAAAAAAGUGF1c2VkAAAAAAAEAAAAAAAAAA9Ub2tlbk5vdEFsbG93ZWQAAAAABQAAAAAAAAAOQW1vdW50VG9vU21hbGwAAAAAAAYAAAAAAAAADkFtb3VudFRvb0xhcmdlAAAAAAAHAAAAAAAAAA9JbnZhbGlkRGVhZGxpbmUAAAAACAAAAAAAAAASSXNzdWVBbHJlYWR5RnVuZGVkAAAAAAAJAAAAAAAAAA5Cb3VudHlOb3RGb3VuZAAAAAAACgAAAAAAAAANSW52YWxpZFN0YXR1cwAAAAAAAAsAAAAAAAAAEkRlYWRsaW5lTm90UmVhY2hlZAAAAAAADAAAAAAAAAAKU2VsZlBheW91dAAAAAAADQAAAAAAAAAMSW52YWxpZFNwbGl0AAAADgAAAAAAAAAKSW52YWxpZEZlZQAAAAAADwAAAAAAAAAIT3ZlcmZsb3cAAAAQAAAAAAAAABFSZWxheWVyTm90QWxsb3dlZAAAAAAAABE=",
        "AAAABQAAAAAAAAAAAAAABkZ1bmRlZAAAAAAAAgAAAAZib3VudHkAAAAAAAZmdW5kZWQAAAAAAAkAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAKbWFpbnRhaW5lcgAAAAAAEwAAAAAAAAAAAAAAB3JlcG9faWQAAAAABgAAAAAAAAAAAAAABWlzc3VlAAAAAAAABgAAAAAAAAAAAAAABXRva2VuAAAAAAAAEwAAAAAAAAAAAAAABmFtb3VudAAAAAAACwAAAAAAAAAAAAAAB2ZlZV9icHMAAAAABAAAAAAAAAAAAAAACGRlYWRsaW5lAAAABgAAAAAAAAAAAAAAD3JlbGF5ZXJfYWxsb3dlZAAAAAABAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAABlBhdXNlZAAAAAAAAgAAAAZib3VudHkAAAAAAAZwYXVzZWQAAAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACERpc3B1dGVkAAAAAgAAAAZib3VudHkAAAAAAAhkaXNwdXRlZAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAGY2FsbGVyAAAAAAATAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAACFJlZnVuZGVkAAAAAgAAAAZib3VudHkAAAAAAAhyZWZ1bmRlZAAAAAIAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAGYW1vdW50AAAAAAALAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAACFJlbGVhc2VkAAAAAgAAAAZib3VudHkAAAAAAAhyZWxlYXNlZAAAAAUAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAGd2lubmVyAAAAAAATAAAAAAAAAAAAAAADbmV0AAAAAAsAAAAAAAAAAAAAAANmZWUAAAAACwAAAAAAAAAAAAAABmNhbGxlcgAAAAAAEwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACFJlc29sdmVkAAAAAgAAAAZib3VudHkAAAAAAAhyZXNvbHZlZAAAAAUAAAAAAAAAAmlkAAAAAAAGAAAAAQAAAAAAAAAGd2lubmVyAAAAAAPoAAAAEwAAAAAAAAAAAAAACndpbm5lcl9uZXQAAAAAAAsAAAAAAAAAAAAAAANmZWUAAAAACwAAAAAAAAAAAAAAEW1haW50YWluZXJfYW1vdW50AAAAAAAACwAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACFVucGF1c2VkAAAAAgAAAAZib3VudHkAAAAAAAh1bnBhdXNlZAAAAAAAAAAC",
        "AAAABQAAAAAAAAAAAAAACFVwZ3JhZGVkAAAAAgAAAAZib3VudHkAAAAAAAh1cGdyYWRlZAAAAAEAAAAAAAAACXdhc21faGFzaAAAAAAAA+4AAAAgAAAAAAAAAAI=",
        "AAAABQAAAAAAAAAAAAAADUNvbmZpZ0NoYW5nZWQAAAAAAAACAAAABmJvdW50eQAAAAAABmNvbmZpZwAAAAAAAQAAAAAAAAAFZmllbGQAAAAAAAARAAAAAQAAAAI=" ]),
      options
    )
  }
  public readonly fromJSON = {
    init: this.txFromJSON<Result<void>>,
        pause: this.txFromJSON<Result<void>>,
        refund: this.txFromJSON<Result<void>>,
        release: this.txFromJSON<Result<void>>,
        resolve: this.txFromJSON<Result<void>>,
        set_fee: this.txFromJSON<Result<void>>,
        unpause: this.txFromJSON<Result<void>>,
        upgrade: this.txFromJSON<Result<void>>,
        get_token: this.txFromJSON<Option<TokenLimits>>,
        set_admin: this.txFromJSON<Result<void>>,
        set_grace: this.txFromJSON<Result<void>>,
        set_token: this.txFromJSON<Result<void>>,
        get_bounty: this.txFromJSON<Result<Bounty>>,
        get_config: this.txFromJSON<Result<Config>>,
        get_totals: this.txFromJSON<Totals>,
        fund_bounty: this.txFromJSON<Result<u64>>,
        set_arbiter: this.txFromJSON<Result<void>>,
        set_relayer: this.txFromJSON<Result<void>>,
        open_dispute: this.txFromJSON<Result<void>>,
        remove_token: this.txFromJSON<Result<void>>,
        set_treasury: this.txFromJSON<Result<void>>,
        active_bounty: this.txFromJSON<Option<u64>>,
        set_durations: this.txFromJSON<Result<void>>
  }
}