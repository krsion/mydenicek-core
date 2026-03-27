import { assertEquals } from "@std/assert";
import { Denicek } from "@mydenicek/core";

type FormulaNode =
  | number
  | {
      $tag: "x-formula-plus";
      left: FormulaNode;
      right: FormulaNode;
    }
  | {
      $tag: "paragraph";
      math: FormulaNode;
    };

Deno.test("Formative: Counter App", () => {
  const peer = new Denicek("alice", {
    $tag: "app",
    formula: 1,
    btn: {
      $tag: "button",
      label: "Add 1",
      script: {
        $tag: "replay-script",
        steps: { $tag: "event-steps", $items: [] },
      },
    },
  });

  const evaluateFormula = (formula: FormulaNode): number =>
    typeof formula === "number"
      ? formula
      : formula.$tag === "paragraph"
      ? evaluateFormula(formula.math)
      : evaluateFormula(formula.left) + evaluateFormula(formula.right);

  const clickButton = (): void => {
    const plainDocument = peer.toPlain() as {
      btn: {
        script: {
          steps: {
            $items: Array<{ eventId: string; target: string }>;
          };
        };
      };
    };
    for (const step of plainDocument.btn.script.steps.$items) {
      peer.replayEditFromEventId(step.eventId, step.target);
    }
  };

  const wrapEventId = peer.wrapRecord("formula", "formula", "x-formula-plus");
  const renameEventId = peer.rename("formula", "formula", "left");
  const addRightEventId = peer.add("formula", "right", 1);

  peer.pushBack("btn/script/steps", { $tag: "replay-step", eventId: wrapEventId, target: "formula" });
  peer.pushBack("btn/script/steps", {
    $tag: "replay-step",
    eventId: renameEventId,
    target: "formula/formula",
  });
  peer.pushBack("btn/script/steps", {
    $tag: "replay-step",
    eventId: addRightEventId,
    target: "formula/right",
  });

  {
    const plainDocument = peer.toPlain() as {
      formula: FormulaNode;
      btn: { script: { steps: { $items: Array<{ eventId: string }> } } };
    };
    assertEquals(plainDocument.btn.script.steps.$items.map((step) => step.eventId), [
      wrapEventId,
      renameEventId,
      addRightEventId,
    ]);
    assertEquals(evaluateFormula(plainDocument.formula), 2);
  }

  clickButton();
  {
    const plainDocument = peer.toPlain() as {
      formula: FormulaNode;
      btn: { script: { steps: { $items: Array<{ eventId: string }> } } };
    };
    assertEquals(plainDocument.btn.script.steps.$items.map((step) => step.eventId), [
      wrapEventId,
      renameEventId,
      addRightEventId,
    ]);
    assertEquals(evaluateFormula(plainDocument.formula), 3);
  }

  peer.wrapRecord("formula", "math", "paragraph");
  peer.set("btn/script/steps/0/target", "formula/math");
  peer.set("btn/script/steps/1/target", "formula/math/formula");
  peer.set("btn/script/steps/2/target", "formula/math/right");

  clickButton();

  assertEquals(evaluateFormula((peer.toPlain() as { formula: FormulaNode }).formula), 4);
});
