// Sentali Backend - Main Fastify server
// - JWT auth with Solana SIWS challenge/verify
// - Pot management (create/list/delete)
// - Deposits (mock rails settlement, USDC escrow)
// - Lulo allocation (single tx vault + Lulo + Jupiter)
// - Contract generation

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import { z } from "zod";
import { PrismaClient } from "@prisma/client";

import nacl from "tweetnacl";
import bs58 from "bs58";
import crypto from "crypto";

import { contractGeneration } from "./routes/contract-generation";
import { deriveVaultPdaFromPotId } from "./lib/escrow";
import {
  anchorDiscriminator,
  decodeInstructionData,
  parseEscrowInstructionData,
} from "./lib/escrow-tx";

import { KurozterOracle } from "./lib/kurozter-oracle";
import { ExchangeConnector } from "./lib/exchange-connector";
import { StressTestDashboard } from "./lib/stress-test-dashboard";

const prisma = new PrismaClient();
const app = Fastify({ logger: true });

const oracle = new KurozterOracle({
  providerUrl: process.env.ETH_RPC_URL || "http://localhost:8545",
  oracleAddress: "0x...",
  assets: ["ETH", "WBTC", "USDC", "DAI", "USDT"]
});

const connector = new ExchangeConnector({
  providerUrl: process.env.ETH_RPC_URL || "http://localhost:8545",
  routerAddress: "0x...",
  usdtAddress: "0x...",
  usdcAddress: "0x..."
});

const dashboard = new StressTestDashboard([
  { name: "oracle_delay", parameters: { propagation_latency_ms: [200, 1500, 3000] }, status: "PENDING", results: [] },
  { name: "collateral_drain", parameters: { drain_rate_pct_per_hour: [0.5, 1.0, 2.0] }, status: "PENDING", results: [] },
  { name: "flash_loan_attack", parameters: { loan_amount_usd: [1000000] }, status: "PENDING", results: [] }
]);

export default app;