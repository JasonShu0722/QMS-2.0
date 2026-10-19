import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { auditActionLabel } from '../../src/modules/audit-log/audit-event-read-model.js';

describe('audit action label coverage (source contract, not PostgreSQL evidence)', () => {
  it('explains literal actions emitted by audit writers and their local forwarding methods', () => {
    const root = resolve('src');
    const actions = new Set<string>();
    function literals(expression: ts.Node | undefined): void {
      if (!expression) return;
      if (ts.isStringLiteralLike(expression)) actions.add(expression.text);
      if (ts.isConditionalExpression(expression)) {
        literals(expression.whenTrue);
        literals(expression.whenFalse);
      }
    }
    function actionProperty(object: ts.Node | undefined): ts.Expression | undefined {
      if (!object || !ts.isObjectLiteralExpression(object)) return;
      const property = object.properties.find((entry) => entry.name?.getText() === 'action');
      if (property && ts.isPropertyAssignment(property)) return property.initializer;
      if (property && ts.isShorthandPropertyAssignment(property)) return property.name;
    }
    function emittedAction(call: ts.CallExpression): ts.Expression | undefined {
      if (call.expression.getText().endsWith('audit.record')) return actionProperty(call.arguments[0]);
      if (call.expression.getText().endsWith('auditEvent.create')) {
        const argument = call.arguments[0];
        if (argument && ts.isObjectLiteralExpression(argument)) {
          const data = argument.properties.find((entry) => entry.name?.getText() === 'data');
          if (data && ts.isPropertyAssignment(data)) return actionProperty(data.initializer);
        }
      }
    }

    // Only inspect production audit sinks; mutation receipts, workflow commands and fixtures are separate facts.
    // Template-built codes are checked by semantic examples in audit-event-read-model.spec.ts.
    for (const file of readdirSync(root, { recursive: true }).map(String).filter((file) => file.endsWith('.ts') && !file.startsWith('generated'))) {
      const source = ts.createSourceFile(file, readFileSync(resolve(root, file), 'utf8'), ts.ScriptTarget.Latest, true);
      const forwarding = new Map<string, number>();
      function discover(node: ts.Node): void {
        if (ts.isCallExpression(node)) {
          const action = emittedAction(node);
          literals(action);
          if (action && ts.isIdentifier(action)) {
            let owner: ts.Node | undefined = node.parent;
            while (owner && !ts.isMethodDeclaration(owner)) owner = owner.parent;
            if (owner && ts.isMethodDeclaration(owner)) {
              const index = owner.parameters.findIndex((parameter) => parameter.name.getText() === action.text);
              if (index >= 0) forwarding.set(`this.${owner.name.getText()}`, index);
            }
          }
        }
        ts.forEachChild(node, discover);
      }
      function callers(node: ts.Node): void {
        if (ts.isCallExpression(node)) {
          const index = forwarding.get(node.expression.getText());
          if (index !== undefined) literals(node.arguments[index]);
        }
        ts.forEachChild(node, callers);
      }
      discover(source);
      callers(source);
    }

    expect(actions.has('ANNOUNCEMENT_CREATED')).toBe(true);
    expect([...actions].filter((action) => !/[\u3400-\u9fff]/u.test(auditActionLabel(action))).sort()).toEqual([]);
  });
});
