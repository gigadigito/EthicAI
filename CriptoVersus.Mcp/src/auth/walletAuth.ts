import crypto from "node:crypto";

import bs58 from "bs58";
import nacl from "tweetnacl";

import type { AppConfig } from "../config.js";
import { UnauthorizedError, ValidationError } from "../utils/errors.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export function normalizeWalletAddress(walletAddress: string): string {
  try {
    const decoded = bs58.decode(walletAddress.trim());
    if (decoded.length !== 32) {
      throw new Error("Invalid public key length.");
    }

    return bs58.encode(decoded);
  } catch {
    throw new ValidationError("Invalid Solana wallet address.");
  }
}

export function createWalletChallenge(config: AppConfig, walletAddress: string): {
  nonce: string;
  message: string;
  expiresAt: string;
  createdAt: string;
} {
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL_MS).toISOString();
  const nonce = crypto.randomUUID();
  const publicUrl = new URL(config.publicBaseUrl);

  const message = [
    "CriptoVersus MCP",
    "",
    "Sign this message to generate a CriptoVersus MCP token.",
    `Domain: ${publicUrl.host}`,
    `Wallet: ${walletAddress}`,
    `Nonce: ${nonce}`,
    `Issued At: ${createdAt}`,
    `Expires At: ${expiresAt}`,
    "",
    "This is a read-only developer authentication flow. It never requests your seed phrase or private key."
  ].join("\n");

  return {
    nonce,
    message,
    expiresAt,
    createdAt
  };
}

export function verifyWalletSignature(input: {
  walletAddress: string;
  message: string;
  signature: string;
}): void {
  let signatureBytes: Uint8Array;

  try {
    signatureBytes = bs58.decode(input.signature.trim());
  } catch {
    throw new UnauthorizedError("Wallet signature is invalid.");
  }

  const publicKeyBytes = bs58.decode(input.walletAddress);
  const messageBytes = new TextEncoder().encode(input.message);
  const isValid = nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);

  if (!isValid) {
    throw new UnauthorizedError("Wallet signature is invalid.");
  }
}
