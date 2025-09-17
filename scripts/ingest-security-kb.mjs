import fs from "fs";
import path from "path";
import matter from "gray-matter";
import { SearchClient, AzureKeyCredential } from "@azure/search-documents";

// --- Validate environment variables ---
if (!process.env.AISEARCH_ENDPOINT || !process.env.AISEARCH_KEY) {
  console.error("❌ Missing AISEARCH_ENDPOINT or AISEARCH_KEY environment variables.");
  process.exit(1);
}

const searchEndpoint = process.env.AISEARCH_ENDPOINT;
const searchIndex = process.env.AISEARCH_INDEX || "security-kb";
const searchKey = process.env.AISEARCH_KEY;

const client = new SearchClient(searchEndpoint, searchIndex, new AzureKeyCredential(searchKey));

function walk(dir) {
  let results = [];
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) results = results.concat(walk(fullPath));
    else if (file.endsWith(".md")) results.push(fullPath);
  });
  return results;
}

async function ingest() {
  const kbPath = path.resolve("./kb");

  if (!fs.existsSync(kbPath)) {
    console.error(`❌ KB folder not found at: ${kbPath}`);
    process.exit(1);
  }

  const files = walk(kbPath);

  if (files.length === 0) {
    console.error(`❌ No .md files found in: ${kbPath}`);
    process.exit(1);
  }

  console.log(`📂 Found ${files.length} KB files in ${kbPath}`);
  console.log("📄 First few files:", files.slice(0, 5).map(f => path.relative(kbPath, f)));

const docs = files.map(f => {
  const raw = fs.readFileSync(f, "utf-8");
  const { data, content } = matter(raw);
  return {
    id: path
      .relative("./kb", f)
      .replace(/\\/g, "_")
      .replace(/\//g, "_")
      .replace(/\.md$/i, "")
      .replace(/[^A-Za-z0-9_\-=]/g, "_"),
    title: data.title || path.basename(f, ".md"),
    source: data.source || "sentali",
    tags: data.tags || [],
    lastReviewed: data.lastReviewed || new Date().toISOString(),
    content
  };
});


  console.log(`⬆️ Uploading ${docs.length} docs to index "${searchIndex}"...`);
  await client.mergeOrUploadDocuments(docs);
  console.log("✅ Ingestion complete.");
}

ingest().catch(err => {
  console.error("❌ Ingestion failed:", err);
  process.exit(1);
});
