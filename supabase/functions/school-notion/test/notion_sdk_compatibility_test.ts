function assertFunction(value: unknown, label: string): void {
  if (typeof value !== "function") {
    throw new Error(`${label} must be a function`);
  }
}

if (typeof Deno !== "undefined") {
  Deno.test("pinned notion sdk exposes required read and future update methods", async () => {
    const { Client } = await import("@notionhq/client");
    const client = new Client({
      auth: "secret_test_token",
      notionVersion: "2026-03-11",
    });

    assertFunction(client.dataSources.query, "dataSources.query");
    assertFunction(client.pages.retrieve, "pages.retrieve");
    assertFunction(client.blocks.children.list, "blocks.children.list");
    assertFunction(client.pages.update, "pages.update");
  });
}
