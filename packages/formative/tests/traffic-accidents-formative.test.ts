import { assertEquals } from "@std/assert";
import { Denicek } from "@mydenicek/core";

Deno.test("Formative: Traffic Accidents", () => {
  const peer = new Denicek("alice", {
    $tag: "app",
    dataSources: {
      $tag: "sources",
      north: {
        $tag: "rows",
        $items: [
          { $tag: "accident", injuries: 1 },
          { $tag: "accident", injuries: 3 },
          { $tag: "accident", injuries: 4 },
        ],
      },
      south: {
        $tag: "rows",
        $items: [
          { $tag: "accident", injuries: 2 },
          { $tag: "accident", injuries: 5 },
        ],
      },
    },
    stats: {
      $tag: "stats",
      primary: {
        $tag: "formula",
        source: { $ref: "/dataSources/north" },
        minInjuries: 3,
        result: 0,
      },
      secondary: {
        $tag: "formula",
        source: { $ref: "/dataSources/south" },
        minInjuries: 0,
        result: 0,
      },
    },
  });

  const resolveValueAtPath = (root: unknown, path: string): unknown => {
    const segments = path.replace(/^\//, "").split("/").filter((segment) => segment.length > 0);
    let current: unknown = root;
    for (const segment of segments) {
      if (typeof current !== "object" || current === null) return undefined;
      if ("$items" in current && Array.isArray((current as { $items?: unknown[] }).$items)) {
        current = (current as { $items: unknown[] }).$items[Number(segment)];
        continue;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  };
  const resolveReferencedValue = (root: unknown, value: unknown): unknown => {
    if (typeof value === "string" && value.startsWith("/")) {
      return resolveReferencedValue(root, resolveValueAtPath(root, value));
    }
    return value;
  };
  const recomputeTrafficStatistic = (statisticPath: string): void => {
    const plainDocument = peer.toPlain();
    const sourceRows = resolveReferencedValue(
      plainDocument,
      resolveValueAtPath(plainDocument, `${statisticPath}/source`),
    ) as {
      $items: Array<{ injuries: number }>;
    };
    const minimumInjuries = Number(
      resolveReferencedValue(plainDocument, resolveValueAtPath(plainDocument, `${statisticPath}/minInjuries`)),
    );
    const nextResult = sourceRows.$items.filter((row) => row.injuries >= minimumInjuries).length;
    peer.set(`${statisticPath}/result`, nextResult);
  };

  peer.copy("stats/secondary", "stats/primary");
  peer.delete("stats/secondary", "source");
  peer.add("stats/secondary", "source", { $ref: "/dataSources/south" });
  peer.delete("stats/secondary", "minInjuries");
  peer.add("stats/secondary", "minInjuries", { $ref: "/stats/primary/minInjuries" });
  recomputeTrafficStatistic("stats/primary");
  recomputeTrafficStatistic("stats/secondary");

  assertEquals(peer.toPlain(), {
    $tag: "app",
    dataSources: {
      $tag: "sources",
      north: {
        $tag: "rows",
        $items: [
          { $tag: "accident", injuries: 1 },
          { $tag: "accident", injuries: 3 },
          { $tag: "accident", injuries: 4 },
        ],
      },
      south: {
        $tag: "rows",
        $items: [
          { $tag: "accident", injuries: 2 },
          { $tag: "accident", injuries: 5 },
        ],
      },
    },
    stats: {
      $tag: "stats",
      primary: {
        $tag: "formula",
        source: "/dataSources/north",
        minInjuries: 3,
        result: 2,
      },
      secondary: {
        $tag: "formula",
        source: "/dataSources/south",
        minInjuries: "/stats/primary/minInjuries",
        result: 1,
      },
    },
  });

  peer.set("stats/primary/minInjuries", 2);
  recomputeTrafficStatistic("stats/primary");
  recomputeTrafficStatistic("stats/secondary");

  assertEquals(peer.toPlain(), {
    $tag: "app",
    dataSources: {
      $tag: "sources",
      north: {
        $tag: "rows",
        $items: [
          { $tag: "accident", injuries: 1 },
          { $tag: "accident", injuries: 3 },
          { $tag: "accident", injuries: 4 },
        ],
      },
      south: {
        $tag: "rows",
        $items: [
          { $tag: "accident", injuries: 2 },
          { $tag: "accident", injuries: 5 },
        ],
      },
    },
    stats: {
      $tag: "stats",
      primary: {
        $tag: "formula",
        source: "/dataSources/north",
        minInjuries: 2,
        result: 2,
      },
      secondary: {
        $tag: "formula",
        source: "/dataSources/south",
        minInjuries: "/stats/primary/minInjuries",
        result: 2,
      },
    },
  });
});
