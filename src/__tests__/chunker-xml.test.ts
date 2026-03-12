import assert from "node:assert/strict";
import test from "node:test";

import { chunkFile } from "../indexer/chunker-treesitter.js";

const workspaceRoot = "/repo";
const defaultChunkerOptions = {
  css_rule_chunk_min_chars: 80,
  max_chunk_chars: {
    module: 12000,
    class: 8000,
    function: 6000,
    method: 4000,
    trait: 6000,
    interface: 6000,
    rule: 2000,
    at_rule: 4000,
    element: 4000,
    doc: 12000
  },
  oversize_strategy: "split" as const
};

test("di.xml emits preference and type element chunks plus the module chunk", () => {
  const xml = `<?xml version="1.0"?>
<config>
  <preference for="Magento\\Catalog\\Api\\ProductRepositoryInterface"
              type="Vendor\\Module\\Model\\ProductRepository"/>
  <type name="Vendor\\Module\\Plugin\\Example">
    <plugin name="vendorPlugin" type="Vendor\\Plugin"/>
  </type>
</config>
`;

  const chunks = chunkFile("/repo/app/etc/di.xml", xml, workspaceRoot, defaultChunkerOptions);

  assert.ok(
    chunks.some((chunk) => chunk.id.includes("preference[Magento\\Catalog\\Api\\ProductRepositoryInterface]"))
  );
  assert.ok(
    chunks.some((chunk) => chunk.id.includes("type[Vendor\\Module\\Plugin\\Example]"))
  );
  assert.ok(chunks.some((chunk) => chunk.chunk_type === "module"));
});

test("layout XML paths emit block and referenceBlock element chunks", () => {
  const xml = `<?xml version="1.0"?>
<page>
  <body>
    <block name="product.info.main" />
    <referenceBlock name="breadcrumbs" />
  </body>
</page>
`;

  const chunks = chunkFile(
    "/repo/app/design/frontend/Vendor/theme/view/frontend/layout/catalog_product_view.xml",
    xml,
    workspaceRoot,
    defaultChunkerOptions
  );

  assert.ok(chunks.some((chunk) => chunk.id.includes("block[product.info.main]")));
  assert.ok(chunks.some((chunk) => chunk.id.includes("referenceBlock[breadcrumbs]")));
});

test("generic XML paths stay module-only", () => {
  const xml = `<?xml version="1.0"?>
<config>
  <route id="example" />
</config>
`;

  const chunks = chunkFile("/repo/config/routes.xml", xml, workspaceRoot, defaultChunkerOptions);

  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every((chunk) => chunk.chunk_type === "module"));
});

test("malformed XML does not throw and falls back to the module chunk", () => {
  let chunks: ReturnType<typeof chunkFile> = [];

  assert.doesNotThrow(() => {
    chunks = chunkFile("/repo/app/etc/di.xml", "<<<not xml", workspaceRoot, defaultChunkerOptions);
  });

  assert.ok(chunks.length >= 1);
  assert.ok(chunks.every((chunk) => chunk.chunk_type === "module"));
});
