import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express, { type Express } from "express";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const publicDirCandidates = [
  path.resolve(currentDir, "..", "public"),
  path.resolve(currentDir, "..", "..", "src", "public"),
  path.resolve(currentDir, "..", "..", "public")
];

const publicDir = publicDirCandidates.find((candidate) => fs.existsSync(candidate)) ?? publicDirCandidates[0];

export function registerWebRoutes(app: Express): void {
  app.use(
    express.static(publicDir, {
      index: "index.html"
    })
  );
}
