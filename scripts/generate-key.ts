#!/usr/bin/env bun
// Generate a secure encryption key for the .env file

import { randomBytes } from "crypto";

const key = randomBytes(32).toString("base64");

console.log("\n🔐 Generated Encryption Key:");
console.log("\nENCRYPTION_KEY=" + key);
console.log("\nAdd this to your .env file\n");
